"""Explicit online installation; the playback worker never downloads weights."""
import json
import os
from pathlib import Path
import sys
from datetime import datetime, timezone
from huggingface_hub import HfApi, snapshot_download

repository = "stabilityai/stable-audio-3-small-sfx"
root = Path(sys.argv[1]).resolve()
root.mkdir(parents=True, exist_ok=True)
token = os.environ.get("HF_TOKEN")
if not token:
    raise SystemExit("Accept model access on Hugging Face and add HF_TOKEN to the ignored .env file first")
revision = HfApi(token=token).model_info(repository).sha
directory = snapshot_download(repository, revision=revision, token=token, cache_dir=str(root / "cache"),
                              allow_patterns=["*.json", "*.safetensors", "*.model", "*.txt", "LICENSE*", "README.md"])
manifest = {"model": "stable-audio-3-small-sfx", "revision": revision, "directory": directory,
            "installedAt": datetime.now(timezone.utc).isoformat()}
temporary = root / "manifest.tmp.json"
temporary.write_text(json.dumps(manifest, indent=2) + "\n")
temporary.replace(root / "manifest.json")
print(json.dumps(manifest))
