"""Offline JSON-lines worker. Cancellation terminates this process, including inference."""
import contextlib
import json
import os
from pathlib import Path
import resource
import socket
import sys
import time
import threading
import uuid

os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_HUB_DISABLE_TELEMETRY="1", DO_NOT_TRACK="1")


def no_network(*args, **kwargs):
    raise RuntimeError("Sound worker networking is disabled; run sound:setup separately")


socket.socket.connect = no_network
socket.socket.connect_ex = no_network
socket.create_connection = no_network
protocol = sys.stdout
sys.stdout = sys.stderr  # Third-party progress must never corrupt the protocol.
root = Path(os.environ["SOUNDSCAPES_SOUND_OUTPUT"]).resolve()
root.mkdir(parents=True, exist_ok=True)
manifest_path = Path(os.environ["SOUNDSCAPES_SOUND_MANIFEST"])
model = None
manifest = json.loads(manifest_path.read_text())
if manifest["model"] != os.environ.get("SOUNDSCAPES_SOUND_MODEL", "stable-audio-3-small-sfx"):
    raise ValueError("Configured model and manifest differ; check SOUND_MODEL_MANIFEST")


def emit(message):
    protocol.write(json.dumps(message, allow_nan=False) + "\n")
    protocol.flush()


def load_model():
    if manifest.get("backend") == "mlx":
        if os.environ.get("SOUNDSCAPES_SOUND_DEVICE") != "mlx":
            raise ValueError("MLX manifest requires SOUND_DEVICE=mlx")
        from mlx_backend import MlxSoundModel
        return MlxSoundModel(manifest), manifest
    import torch
    from stable_audio_3 import StableAudioModel
    from stable_audio_3.loading_utils import load_diffusion_cond

    directory = Path(manifest["directory"]).resolve()
    config = json.loads((directory / "model_config.json").read_text())

    def localize(value):
        if isinstance(value, dict):
            if value.get("repo_id") == f"stabilityai/{manifest["model"]}":
                value["repo_id"] = str(directory)
            for child in value.values():
                localize(child)
        elif isinstance(value, list):
            for child in value:
                localize(child)

    localize(config)
    device = os.environ.get("SOUNDSCAPES_SOUND_DEVICE", "cpu")
    if device not in ("cpu", "mps"):
        raise ValueError("Only CPU and MPS are supported by this worker")
    torch.set_num_threads(int(os.environ.get("SOUNDSCAPES_SOUND_THREADS", "4")))
    diffusion = load_diffusion_cond(config, str(directory / "model.safetensors"), device=device, model_half=False)
    diffusion.use_lora = False
    diffusion.lora_names = []
    return StableAudioModel(diffusion, config, device, False), manifest


# Do not leave expensive inference running if the owning Node server is killed.
parent_pid = os.getppid()


def watch_parent():
    while True:
        time.sleep(0.5)
        if os.getppid() != parent_pid:
            os._exit(1)


threading.Thread(target=watch_parent, daemon=True).start()
emit({"type": "ready", "protocol": 1, "network": "disabled"})
for line in sys.stdin:
    request = {}
    target = None
    try:
        if len(line) > 32768:
            raise ValueError("Request exceeds protocol limit")
        request = json.loads(line)
        identifier = str(uuid.UUID(request["id"]))
        duration = request["durationSeconds"]
        if not isinstance(duration, int) or not 2 <= duration <= 120:
            raise ValueError("Unsupported duration")
        if not isinstance(request["prompt"], str) or not 1 <= len(request["prompt"]) <= 6000:
            raise ValueError("Invalid prompt")
        if not isinstance(request["seed"], int) or not 0 <= request["seed"] <= 2147483647:
            raise ValueError("Invalid seed")
        target = root / f"{identifier}.wav"
        started = time.monotonic()
        load_ms = 0
        if model is None:
            model, manifest = load_model()
            load_ms = (time.monotonic() - started) * 1000
        import numpy as np
        import soundfile as sf

        print(f"Generating {manifest['model']}: {duration}s seed={request['seed']} id={identifier}", flush=True)
        if manifest.get("backend") == "mlx":
            audio, stage_load_ms = model.generate(request["prompt"], duration, request["seed"])
            load_ms += stage_load_ms
        else:
            import torch
            with torch.inference_mode():
                audio = model.generate(prompt=request["prompt"], duration=duration, steps=8, seed=request["seed"], batch_size=1)
            audio = audio[0].to("cpu", dtype=torch.float32).numpy()[:, :duration * 44100]
        if audio.shape != (2, duration * 44100) or not np.isfinite(audio).all():
            raise ValueError("Generated audio is not finite stereo PCM of the requested duration")
        sf.write(str(target), audio.T, 44100, subtype="FLOAT")
        rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        emit({"type": "result", "audio": {
            "id": identifier, "path": str(target), "model": manifest["model"], "resident": manifest.get("backend") != "mlx", "revision": manifest["revision"],
            "durationSeconds": duration, "sampleRate": 44100, "channels": 2,
            "elapsedMs": (time.monotonic() - started) * 1000, "loadMs": load_ms,
            "peakRssBytes": rss if sys.platform == "darwin" else rss * 1024,
        }})
    except Exception as error:
        if target is not None:
            with contextlib.suppress(OSError):
                target.unlink()
        emit({"type": "error", "id": request.get("id"), "message": str(error)[:2000]})
