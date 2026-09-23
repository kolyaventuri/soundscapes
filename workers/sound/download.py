"""Explicit online installation; the playback worker never downloads weights."""
import io
import json
import os
from pathlib import Path
import platform
import sys
import urllib.request
import zipfile
from datetime import datetime, timezone
from huggingface_hub import HfApi, snapshot_download

RUNTIME_REVISION = "779434a908193105335fd8d833418603625b2859"
manifest_path = Path(sys.argv[1]).resolve()
root = manifest_path.parent
model = sys.argv[2]
device = sys.argv[3]
if model not in ("stable-audio-3-small-sfx", "stable-audio-3-small-music", "stable-audio-3-medium"):
    raise SystemExit("Unknown sound model")
if device == "mlx" and (platform.system(), platform.machine()) != ("Darwin", "arm64"):
    raise SystemExit("MLX requires an Apple Silicon Mac")
if model.endswith("medium") and device != "mlx":
    raise SystemExit("Use SOUND_DEVICE=mlx for Medium on this Mac")
root.mkdir(parents=True, exist_ok=True)
token = os.environ.get("HF_TOKEN")
if not token:
    raise SystemExit("Accept model access on Hugging Face and add HF_TOKEN to the ignored .env file first")
repository = "stabilityai/stable-audio-3-optimized" if device == "mlx" else f"stabilityai/{model}"
patterns = ["*.json", "*.safetensors", "*.model", "*.txt", "LICENSE*", "NOTICE*", "README.md"]
if device == "mlx":
    suffix = {"stable-audio-3-medium": "medium", "stable-audio-3-small-sfx": "sm-sfx", "stable-audio-3-small-music": "sm-music"}[model]
    codec = "l" if suffix == "medium" else "s"
    patterns = [f"MLX/dit_{suffix}_f16.npz", f"MLX/same_{codec}_decoder_f32.npz", "MLX/t5gemma_f16.npz", "LICENSE*", "NOTICE*", "README.md"]
revision = HfApi(token=token).model_info(repository).sha
print(f"Installing {model} ({device}) from {repository}@{revision}", flush=True)
directory = snapshot_download(repository, revision=revision, token=token, cache_dir=str(root / "cache"), allow_patterns=patterns)
manifest = {"model": model, "backend": "mlx" if device == "mlx" else "torch", "repository": repository,
            "revision": revision, "directory": directory, "installedAt": datetime.now(timezone.utc).isoformat()}
if device == "mlx":
    # Only import the pinned model definitions; never invoke upstream auto-download/UI helpers.
    url = f"https://codeload.github.com/Stability-AI/stable-audio-3/zip/{RUNTIME_REVISION}"
    with urllib.request.urlopen(url, timeout=60) as response:
        archive = zipfile.ZipFile(io.BytesIO(response.read()))
    prefix = f"stable-audio-3-{RUNTIME_REVISION}/optimized/mlx/"
    runtime = root / "runtime"
    for name in archive.namelist():
        if not name.startswith(prefix):
            continue
        relative = Path(name[len(prefix):])
        if ".." in relative.parts or relative.is_absolute():
            raise ValueError("Unsafe runtime archive path")
        if str(relative).startswith("models/") and relative.suffix == ".py":
            target = runtime / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(archive.read(name))
    manifest.update(runtime=str(runtime), runtimeRevision=RUNTIME_REVISION)
temporary = manifest_path.with_suffix(".tmp.json")
temporary.write_text(json.dumps(manifest, indent=2) + "\n")
temporary.replace(manifest_path)
print(json.dumps(manifest))
