# Soundscapes

Generate environmental soundscapes from a description and stream them continuously in your browser. Describe a forest, a busy café, a seaside restaurant, or an imagined place—with ambient sound, background music, and occasional activity. Enable sleep mode when you want gentler dynamics.

Soundscapes runs on your own computer: Ollama interprets the scene, Stable Audio generates recordings, and FFmpeg mixes them into an AAC/HLS stream. Audio generation and playback stay local after model setup.

**Status:** experimental, pre-v0.1. Audio fidelity, musical continuity, and device compatibility are still being evaluated. See [PLAN.md](PLAN.md) for the roadmap, [SPEC.md](SPEC.md) for the design, and [ACCEPTANCE.md](ACCEPTANCE.md) for verification coverage.

## Features

- Prompt-based scene generation with reusable audio assets.
- Continuous ambience with crossfades and occasional locally planned events.
- Optional layered scenes with independent ambience, music, crowd, and effects timing.
- Live preparation progress and approximate readiness estimates based on measured runs.
- Shared streams with per-listener pause/resume, persistent sessions, and automatic idle shutdown.
- Scene-level volume adjustment, optional sleep mode, and browser media controls.
- An installable web app with an offline app shell. Streaming and generation still require the server.

## Requirements

- **Node.js 24**, version 24.12 or newer within that major release. Use a maintained patch release.
- **pnpm 10.29.3**, as declared in `package.json`.
- **FFmpeg and ffprobe** on your `PATH`, with AAC encoding and HLS support.
- For generated scenes: **Ollama**, **Python 3.12**, **uv**, and access to the selected Stable Audio model.

The checked-in sound-worker dependency lock targets **macOS on Apple Silicon**, including MLX/Metal packages. The worker also supports PyTorch CPU/MPS configurations, but the current lock is not a portable Linux/Windows installation recipe. Memory requirements and preparation speed depend on the selected models and hardware; no universal minimum or latency guarantee is established.

Model downloads require network access and acceptance of their licenses. Docker is not required for the documented setup.

## Quick start: test playback without models

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm ambience:create
pnpm audio:smoke
pnpm dev
```

Open [localhost:5173](http://localhost:5173), leave the scene description blank, choose **Prepare test stream**, then press Play. This uses synthesized air/noise recordings to verify the playback path; it does not generate an environmental scene.

Vite serves the client on port 5173 and proxies `/api` to Fastify on port 3000. Stop development processes with Ctrl-C.

For a built, single-origin app:

```sh
pnpm build
pnpm start
```

Open [localhost:3000](http://localhost:3000). Rebuild after source changes. Run only one server per data directory.

**Deployment boundary:** the server has no authentication and is intended for a trusted local network. It binds to `0.0.0.0` by default; use `HOST=127.0.0.1` for loopback-only access. Do not expose it directly to the internet.

## Set up local generation

### 1. Configure the application

Copy the example configuration if you do not already have a local `.env`:

```sh
cp .env.example .env
```

The example selects Medium with MLX for Apple Silicon. Review the settings for your hardware before installing models. Shell environment variables override `.env`; never put credentials in `VITE_*` variables, which are exposed to the browser.

### 2. Start Ollama

Install Ollama and start it in a separate terminal from the repository root:

```sh
OLLAMA_HOST=127.0.0.1:11434 \
OLLAMA_MODELS="$PWD/models/ollama" \
OLLAMA_NUM_PARALLEL=1 \
OLLAMA_MAX_LOADED_MODELS=1 \
OLLAMA_NO_CLOUD=1 \
ollama serve
```

With that process running, download the planner model and verify it:

```sh
ollama pull qwen3:8b
pnpm planner:smoke
```

Keep Ollama running while using prompted scenes. The application accepts only a loopback Ollama endpoint and has no hosted-provider fallback.

### 3. Install the sound worker and model

**Powered by Stability AI.** Review the model-access requirements and bundled [Stable Audio notices](third_party/stable-audio-3/NOTICE.txt), [Stability license](third_party/stable-audio-3/LICENSE.md), and [Gemma terms](third_party/stable-audio-3/LICENSE_GEMMA.md). Model access and licensing are separate from the application dependencies.

Accept access on Hugging Face for the [optimized MLX models](https://huggingface.co/stabilityai/stable-audio-3-optimized), [Small-SFX](https://huggingface.co/stabilityai/stable-audio-3-small-sfx), or [Small-Music](https://huggingface.co/stabilityai/stable-audio-3-small-music), as appropriate for your configuration. Then put a read-access `HF_TOKEN` in your ignored `.env`. Do not commit it. Setup uses the token to download model files; inference does not receive it.

For the Apple Silicon dependency lock:

```sh
uv venv --python 3.12 models/sound-runtime
uv pip install --python models/sound-runtime/bin/python \
  -r workers/sound/requirements.txt
pnpm sound:setup
pnpm sound:smoke
```

Model selection uses `SOUND_MODEL` (`small-sfx`, `small-music`, or `medium`) and `SOUND_DEVICE` (`cpu`, `mps`, or `mlx`). MLX is the Apple Silicon backend; Medium currently requires MLX in this application. The runtime source is pinned, and setup records the downloaded model revision in a local manifest; normally leave `SOUND_MODEL_MANIFEST` unset so it follows the selected model and backend.

After changing models, run setup for that configuration, restart the application, and create a new scene. Existing sessions retain their prepared recordings. Model identity, revision, backend, and generation prompts participate in asset reuse.

### 4. Create a scene

Start `pnpm dev`, enter a description, and choose **Prepare scene**. For example:

> A café on a rainy afternoon. Indistinct conversation, cups clinking, rain against the windows, and quiet jazz piano in the background.

Wait for **Ready to play**, then press Play. Preparation can take several minutes. Progress shows actual work and measured estimates where available; unfamiliar workloads use an indeterminate state.

Worker progress appears in the server terminal with a `[sound-worker]` prefix. A direct sound-generation check can help distinguish planner interpretation from audio-model output:

```sh
pnpm sound:smoke --bed --prompt "Waves breaking on a distant shore, heard from a sheltered beach café."
pnpm sound:smoke --scene
```

## Using Soundscapes

**Open sessions** lists sessions retained by the server, including paused or failed sessions. **Open** rejoins a session; **Close** and **Close all** end playback for its listeners and free capacity. Closing a tab does not close the server session. The prototype supports four sessions and sixteen listeners per session.

**Sleep mode** requests gentler dynamics while preserving requested music and crowd murmur. **Scene level** changes the shared stream from 0–150%; device volume remains the immediate personal control. Stream-level changes become audible after already-buffered audio plays out.

Pause stops rendering when no listeners remain active. The scene clock freezes while idle. A listener expires after 90 seconds without successful audio-segment consumption by default. Status and diagnostic polling do not keep it alive. Normal server shutdown preserves session state; explicit Stop is terminal.

### Automatic layered scenes

Enable **Layered scene (advanced)** to plan layers from the same single description. There is no manual track configuration. Preparation takes longer because layers have separate recordings and independent boundaries.

| Layer | Recording length | Initial pool | Maximum pool |
| --- | --- | --- | --- |
| Ambience | 90 seconds | 4 | 4 |
| Music | 120 seconds | 2 | 3 |
| Human activity / crowd | 75 seconds | 2 | 3 |
| Effects | 10 seconds | 2 | 6 |

Only appropriate layers are selected. Available capacity and playback buffer allow pools to expand in the background; expansion stops at their limits. The output remains one HLS stream. Optional generation failures preserve the usable scene and surface a warning.

Layering is experimental: clean source isolation, precise distance, intelligible dialogue, and matching musical key/tempo/phrasing are not guaranteed. Generated audio receives format validation, normalization, and peak protection, but numerical checks do not establish listening quality.

## Configuration

See [.env.example](.env.example) for the configuration template and [config.ts](apps/server/src/config.ts) for complete validation rules. Paths resolve from the repository root unless absolute.

| Variable | Default without `.env` | Purpose |
| --- | --- | --- |
| `HOST` / `PORT` | `0.0.0.0` / `3000` | API and built-client listen address. |
| `DATA_DIR` | `data` | SQLite, audio assets, session files, and diagnostic output. |
| `LOG_LEVEL` | `info` | Server logging verbosity. |
| `FFMPEG_PATH` / `FFPROBE_PATH` | `ffmpeg` / `ffprobe` | Audio tool executables. |
| `IDLE_TIMEOUT_SECONDS` | `90` | Listener inactivity timeout. |
| `OLLAMA_URL` / `OLLAMA_MODEL` | `http://127.0.0.1:11434` / `qwen3:8b` | Local planner endpoint and model. |
| `PLANNER_TIMEOUT_SECONDS` | `45` | Scene/event planning deadline. |
| `SOUND_ENABLED` | `true` | Enable sound generation for prompted scenes. |
| `SOUND_MODEL` / `SOUND_DEVICE` | `small-sfx` / `cpu` | Sound model and backend; the example `.env` selects `medium` / `mlx`. |
| `SOUND_PYTHON` | `models/sound-runtime/bin/python` | Worker interpreter. |
| `SOUND_TIMEOUT_SECONDS` | `300` | Sound-job deadline. |
| `SOUND_IDLE_UNLOAD_SECONDS` | `1800` | Idle worker retention; `0` unloads immediately. |
| `TLS_CERT_FILE` / `TLS_KEY_FILE` | unset | Optional HTTPS certificate/key pair. |
| `API_PROXY_TARGET` | `http://127.0.0.1:<PORT>` | Development proxy; update the example's explicit value if changing ports. |
| `HF_TOKEN` | unset | Model-download credential, used only during setup. |

Event cadence and asset reuse can be adjusted with `EVENT_DELAY_SCALE`, `EVENT_DELAY_BUCKETS`, `EVENT_SKIP_PROBABILITY`, and `ASSET_REUSE_THRESHOLD`. Keep defaults for representative listening and endurance tests. `SOUND_ENABLED=false` uses synthesized ambience for prompted planner tests; it still requires Ollama.

## Installable app and trusted LAN HTTPS

Use the built app over trusted HTTPS to install it on another device. The service worker caches only the static app shell—not API responses, HLS, or generated audio. Offline access does not provide offline playback.

Create a certificate using your preferred local certificate authority. For example, with mkcert installed:

```sh
mkcert -install
mkdir -p data/tls
# Replace these example values with the server's reachable LAN name and address.
SOUNDSCAPES_HOST=soundscapes.local
SOUNDSCAPES_IP=192.168.1.100
mkcert -cert-file data/tls/lan.pem -key-file data/tls/lan-key.pem \
  "$SOUNDSCAPES_HOST" "$SOUNDSCAPES_IP" localhost 127.0.0.1 ::1
pnpm build
HOST=0.0.0.0 PORT=3443 \
TLS_CERT_FILE=data/tls/lan.pem TLS_KEY_FILE=data/tls/lan-key.pem pnpm start
```

A certificate does not configure DNS: the hostname must resolve to the server, or use the certified LAN IP. Configure the listen address for your network; IPv6 requires an appropriate bind address and OS support.

Install and trust the local CA's **public `rootCA.pem`** on the client device using its certificate-trust settings. Keep `rootCA-key.pem` and the server private key secret. Open the matching HTTPS address without certificate warnings, then use Safari's **Share → Add to Home Screen** on iPhone. Both TLS variables must be set together. Keep certificates under ignored `data/tls/`.

## Development checks and diagnostics

```sh
pnpm check               # Lint, types, Vitest, and production builds
pnpm audio:smoke         # FFmpeg AAC/HLS capability
pnpm audio:integration   # Real streaming and session lifecycle
pnpm audio:mixer         # Crossfade and PCM continuity
pnpm audio:phase2        # Ambience, buffers, retention, restart
pnpm audio:level         # File and streamed-PCM level checks
pnpm audio:phase3        # Event scheduling with a scripted planner
pnpm audio:phase4        # Generation lifecycle with a scripted worker
pnpm audio:layers        # Layered scheduling/mixing with scripted models
pnpm lan:smoke           # HTTPS and recorder trust checks
```

For real local models, use `pnpm planner:smoke`, `pnpm sound:smoke --scene`, `pnpm audio:layers --real`, or `pnpm acceptance:run`. The last command runs a short integrated generation/playback/recovery check with accelerated events. These checks do not replace human listening or physical-device endurance tests.

Inspect `/api/debug/sessions/<SESSION_UUID>` for playback buffers, listener activity, planning, and worker state. `/api/debug/assets?offset=0&limit=25` provides paged asset metadata. Debug reads do not renew playback activity.

Inspect prompts and individual recordings without changing playback:

```sh
pnpm session:prompts --latest
pnpm session:prompts SESSION_UUID
pnpm wav:play --session SESSION_UUID --wav WAV_NUMBER
```

`--latest` selects the most recently created persisted session. Use a WAV number from the prompt report; these refer to individual normalized recordings, not the final mix.

## Record an unattended playback run

Use a fixed production build, keep the server computer powered and awake, and start playback in the browser or installed app. Do not rebuild or restart the server during the run. Obtain the session ID from the page's `?session=...` URL, then run the recorder on the server computer using the same configuration/data directory:

```sh
pnpm soak:record --url http://127.0.0.1:3000 \
  --session SESSION_UUID --hours 8 \
  --device "Device model; OS/browser version; audio output"
```

For the HTTPS setup above, supply the public CA certificate and HTTPS origin:

```sh
NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem" \
  pnpm soak:record --url https://127.0.0.1:3443 \
  --session SESSION_UUID --hours 8 \
  --device "Device model; OS/browser version; audio output"
```

On macOS, prefix `pnpm` with `caffeinate -i` to inhibit idle sleep; keep the lid open. Use the equivalent power settings on other systems. The recorder monitors an existing session—it does not start playback or keep a listener active. Ctrl-C stops recording without stopping playback.

Results appear under `data/soaks/` (or the configured data directory): `summary.md`, `summary.json`, a run manifest, and bounded sample/event logs. Sampling defaults to 30 seconds. Run `pnpm soak:record --help` for options.

Exit code `0` means the requested duration completed without detected telemetry issues; `2` means interruption or issues requiring review; `1` means recorder failure. Samples may miss short interruptions and do not prove audible continuity. Session-disk totals exclude reusable assets, the database, and recorder logs; external Ollama/GPU allocation is not measured. Keep raw run artifacts local and summarize relevant results separately.

## iPhone and Bluetooth acceptance

Connect the phone to the same trusted network as the server and use its reachable address. Use trusted HTTPS for installed-app checks.

1. Prepare a scene, start playback, connect the intended audio device, and lock the phone. Listen across several clip transitions.
2. Pause from the lock screen. With no other listeners, verify idle status, stopped rendering, no producer PID, and a frozen scene clock. Resume playback.
3. Disconnect the network without pausing. After the idle timeout, verify that rendering stops. Reconnect and check recovery.
4. For endurance testing, record eight hours of active playback with the soak recorder. Ensure the audio device's own sleep timer will not pause the run early.
5. Check representative scenes for recognizable sources, comfortable levels, smooth transitions, and distracting repetition. Record audible interruptions and deliberate pauses separately from server telemetry.

Desktop, automated, and physical-device evidence establish different things. Keep that distinction in release acceptance; a healthy recorder report alone does not establish listening quality.

## Project structure and contributing

```text
apps/web/          React/Vite player and installable app shell
apps/server/       Fastify API, session management, mixing, and diagnostic CLIs
packages/shared/   Browser-safe schemas and API types
workers/sound/     Local Python sound-generation worker
third_party/       Model notices and license terms
SPEC.md            Product design
PLAN.md            Implementation and acceptance checklist
ACCEPTANCE.md      Verification coverage and limitations
```

Use pnpm and preserve the lockfile. Run `pnpm check` and the relevant audio/model checks for your changes; see [AGENTS.md](AGENTS.md) for repository guidance. Keep Node, filesystem, and model dependencies out of the shared browser package.

Runtime state belongs in ignored `data/` and `models/`. Do not commit generated audio, model weights, databases, HLS segments, credentials, certificates, or raw logs. Public documentation should describe reproducible setup and supported behavior, using placeholders for machine-specific values.
