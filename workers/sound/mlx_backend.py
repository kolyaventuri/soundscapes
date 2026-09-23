"""Offline adapter around the pinned official Apple Silicon model definitions.

Use the upstream 8-step sampler, FP16 DiT, FP32 codec and chunk geometry.
Release each stage before loading the next so Medium fits comfortably in memory.
"""
import gc
import importlib
import math
from pathlib import Path
import sys
import time


class MlxSoundModel:
    def __init__(self, manifest):
        import mlx.core as mx
        if not mx.metal.is_available():
            raise RuntimeError("MLX sound generation requires Apple Silicon Metal access")
        runtime = Path(manifest["runtime"])
        if manifest.get("runtimeRevision") != "779434a908193105335fd8d833418603625b2859":
            raise ValueError("Unsupported MLX runtime revision; run sound:setup")
        sys.path.insert(0, str(runtime))
        self.directory = Path(manifest["directory"]) / "MLX"
        self.variant = {"stable-audio-3-medium": "medium", "stable-audio-3-small-sfx": "sm-sfx", "stable-audio-3-small-music": "sm-music"}[manifest["model"]]
        self.codec = "l" if self.variant == "medium" else "s"
        for file in ("t5gemma_f16.npz", f"dit_{self.variant}_f16.npz", f"same_{self.codec}_decoder_f32.npz"):
            if not (self.directory / file).is_file():
                raise FileNotFoundError(f"Missing local MLX weight {file}; run sound:setup")

    def generate(self, prompt, duration, seed, progress=lambda *args: None):
        import mlx.core as mx
        import numpy as np
        from models.defs.t5gemma_mlx import T5Gemma
        from models.defs.sa3_pipeline import (
            apply_prompt_padding, build_pingpong_schedule, sample_flow_pingpong,
            patched_decode, load_conditioner_from_npz,
        )

        def release():
            gc.collect()
            mx.clear_cache()

        mx.reset_peak_memory()
        started = time.monotonic()
        dit_path = str(self.directory / f"dit_{self.variant}_f16.npz")
        print("MLX: encoding scene prompt", flush=True)
        encoder = T5Gemma.from_npz(str(self.directory / "t5gemma_f16.npz"))
        load_ms = (time.monotonic() - started) * 1000
        embeds, mask = encoder.encode([prompt], max_len=256)
        padding, seconds = load_conditioner_from_npz(dit_path, prefix="cond.")
        padded = apply_prompt_padding(embeds.astype(mx.float16), mask, padding.astype(mx.float16))
        seconds_embed = seconds(duration).astype(mx.float16)
        cross = mx.concatenate([padded, seconds_embed], axis=1)
        global_cond = seconds_embed[:, 0, :]
        mx.eval(cross, global_cond)
        del encoder, embeds, mask, padding, seconds, padded, seconds_embed
        release()

        length = math.ceil(duration * 44100 / 4096)
        module = importlib.import_module("models.defs.dit_mlx_medium" if self.variant == "medium" else "models.defs.dit_mlx")
        started = time.monotonic()
        dit = module.load_dit(dit_path, T_lat=length, dtype=mx.float16, compile_=False)
        load_ms += (time.monotonic() - started) * 1000
        noise = mx.random.normal((1, 256, length), dtype=mx.float16, key=mx.random.key(seed))
        schedule = build_pingpong_schedule(8, sigma_max=1.0, use_logsnr_shift=True)
        def model_fn(x, t):
            return dit(x, t, cross, global_cond, local_add_cond=None)
        def on_step(step, total):
            print(f"MLX: sampling {step}/{total}", flush=True)
            progress("generating", step, total)
        progress("generating", 0, 8)
        latents = sample_flow_pingpong(model_fn, noise, schedule, seed=seed + 1,
                                      on_step=on_step)
        mx.eval(latents)
        del dit, model_fn, noise, cross, global_cond
        release()

        print("MLX: decoding stereo audio", flush=True)
        progress("decoding")
        module = importlib.import_module(f"models.defs.same_{self.codec}_decoder")
        started = time.monotonic()
        decoder = module.load_model(weights_path=str(self.directory / f"same_{self.codec}_decoder_f32.npz"), dtype=mx.float32, compile_=False)
        load_ms += (time.monotonic() - started) * 1000
        chunk, overlap = (128, 8) if self.codec == "l" else (8, 2)
        latents = latents.astype(mx.float32)
        if length > chunk + 2 * overlap:
            patches = module.decode_chunked(decoder, latents, chunk, overlap)
        elif length % 2 == 0:
            patches = decoder(latents)
        else:
            # Supported requests are >= 2 seconds, so an even six-latent kernel fits.
            patches = module.decode_chunked(decoder, latents, 2, 2)
        audio = patched_decode(patches, patch_size=256, channels=2)
        mx.eval(audio)
        result = np.array(audio.astype(mx.float32))[0, :, :duration * 44100]
        peak = mx.get_peak_memory()
        del decoder, latents, patches, audio
        release()
        print(f"MLX: complete; peak Metal allocation {peak / 1024**3:.2f} GiB", flush=True)
        return result, load_ms
