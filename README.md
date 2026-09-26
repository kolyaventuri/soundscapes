# Soundscapes

Generate environmental soundscapes from a description and stream them continuously in your browser. Describe a forest, a busy café, a seaside restaurant, or an imagined place—with ambient sound, background music, and occasional activity. Enable sleep mode when you want gentler dynamics.

Soundscapes runs on your own computer: Ollama interprets the scene, Stable Audio generates recordings, and FFmpeg mixes them into an AAC/HLS stream. Audio generation and playback stay local after model setup.

**Status:** v0.1 prototype acceptance complete. Core generation/playback, focused listening checks, and measured laptop/locked-iPhone endurance are accepted; see the [completed checklist](PLAN.md#remaining-v01-checks). Advanced layering remains an optional prototype with further fidelity work planned. [SPEC.md](SPEC.md) defines the product, and [ACCEPTANCE.md](ACCEPTANCE.md) records verified behavior and limitations.

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

**Scene details** expands beneath the player (and during preparation) to show your original description, the interpreted setting, weather, activity, constraints and scene clock. Layered scenes include the planned source captions, continuous/occasional playback and live recording counts: preparing, ready, adding variations, complete, or a warning. It is read-only and uses the existing passive status polling.

**Saved scenes** keeps successfully prepared descriptions and their Simple/Layered and Sleep settings, even after their sessions close. Search names, places or original descriptions, expand **View scene**, then choose **Use description** to fill the creation form. You can edit it before choosing **Prepare scene**; it creates a new session through normal planning/generation and may reuse compatible recordings. To resume the exact existing world, use **Open sessions** instead. Browsing is available during playback; reusing a description requires stopping the current session first.

Choose **Delete** on a saved scene and confirm to clear that description, its saved mode variants and its sessions. This closes playback for sessions using the same description and clears their cached recordings. Preparing the identical description afterward generates fresh audio, even if an old WAV remains on disk for another saved scene. Sessions using a different description continue normally. Generated WAVs without another scene reference are removed; shared WAVs and imported recordings are kept.

The library migrates automatically to SQLite v5 on server startup and includes still-retained prepared sessions. Repeated identical descriptions/settings share one saved entry. Sessions deleted before the library feature cannot be reconstructed. New references reflect actual recording use; existing legacy references are retained where the old database cannot distinguish genuine sharing from inferred compatibility. Cache invalidation persists independently of file removal: a file waiting for an in-flight consumer or a cleanup retry cannot become a cache hit for the deleted description. Cleanup retries automatically and does not wait for unrelated idle sessions.

The uncached `GET /api/scenes?q=...&offset=0` returns at most twelve entries; reading it never creates listeners, starts inference or renews playback activity. `DELETE /api/scenes/:id` clears the description and returns the closed session IDs and file-cleanup status. Restart an older running server after updating; for the installed PWA, close and reopen the app to pick up the new shell once available.

**Sleep mode** requests gentler dynamics while preserving requested music and crowd murmur. **Scene level** changes the shared stream from 0–150%; device volume remains the immediate personal control. Stream-level changes become audible after already-buffered audio plays out.

Pause stops rendering when no listeners remain active. The scene clock freezes while idle. A listener expires after 90 seconds without successful audio-segment consumption by default. Status and diagnostic polling do not keep it alive. Normal server shutdown preserves session state; explicit Stop is terminal.

### Automatic layered scenes

Enable **Layered scene (advanced)** to plan layers from the same single description. There is no manual track configuration. Preparation takes longer because layers have separate recordings and independent boundaries.

| Layer | Recording length | Initial pool | Maximum pool |
| --- | --- | --- | --- |
| Ambience | 90 seconds | 4 | 4 |
| Music | 120 seconds | 2 | 3 |
| Human activity / crowd | 75 seconds | 2 | 3 |
| Effects | 2–10 seconds, one source per recording | 2–4, covering each source | 6 |

Only appropriate layers are selected. Available capacity and playback buffer allow pools to expand in the background; expansion stops at their limits. The output remains one HLS stream. Optional generation failures preserve the usable scene and surface a warning.

Describe frequency separately for each effect: “frequent cup clinks, occasional espresso sounds, and a rare horn.” Each source gets its own timing: frequent uses 20–45-second gaps, occasional 45–120 seconds, and rare 3–7 minutes. The first occurrence also waits within its range. Effects wait for one another with at least five seconds of quiet between recordings, so a busy mix may lengthen a gap. Loudness does not imply frequency. Fresh sessions use these policies; existing sessions keep their saved schedules. `pnpm session:prompts SESSION_UUID` shows the interpreted source captions and gaps.

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

`pnpm planner:smoke --policies` runs the focused real-model regression for per-source effect frequency and exclusions such as retaining creek/espresso sounds while excluding rain/horns. The full planner smoke includes these checks.

Inspect `/api/debug/sessions/<SESSION_UUID>` for playback buffers, listener activity, planning, and worker state. `/api/debug/assets?offset=0&limit=25` provides paged asset metadata. Debug reads do not renew playback activity.

Inspect prompts and individual recordings without changing playback:

```sh
pnpm session:prompts --latest
pnpm session:prompts SESSION_UUID
pnpm wav:play --session SESSION_UUID --wav WAV_NUMBER
```

`--latest` selects the most recently created persisted session. Use a WAV number from the prompt report; these refer to individual normalized recordings, not the final mix.

## Record an unattended playback run

The project's laptop and locked-iPhone endurance runs are complete. This procedure is for a new deployment or a specific regression investigation; it is not another outstanding release test. Bluetooth playback and controls are already accepted, with no separate Bluetooth endurance requirement.

Use a fixed production build, keep the server computer powered and awake, and start playback in the browser or installed app. Do not rebuild or restart the server during the run.

### Record from the PWA

Open **Playback diagnostics** below the player. Choose **5-minute check** or **8-hour recording**, enter the device/OS/audio-output details, and tap **Start recording**. It uses the current session automatically. Wait for the complete-sample count to increase before locking the device. Samples are collected on the server every five seconds for the check, or every thirty seconds for the overnight run. No separate recorder terminal or session ID is needed.

**Stop recording** ends diagnostics without changing playback. An early stop is marked **interrupted**. Pause continues to stop rendering normally; diagnostics record the interruption without keeping a listener alive. The requested duration completes automatically even if this page is closed. A stopped/failed/unavailable session ends its recording early. One recording can run per server; repeated Start for the same session returns the existing run.

Under **Recent recordings**, expand a run for its result, issue counts, observed planner calls, new audio recordings and cache reuses. **Download summary** saves a text report. The latest twenty PWA recordings remain available after reloading or closing the playback session; older raw files remain under `data/soaks/pwa-<RECORDING_UUID>/`. Runs created by the CLI below are separate and do not appear in PWA history. Neither API reads nor recording controls start inference or renew listeners; API and summary responses are uncached.

A server shutdown or crash interrupts its embedded recorder. After restart, an unfinished run is marked interrupted at its last saved sample; time while the server was unavailable is not counted. Logs rotate within about 24 MiB per run, plus summaries and manifest. Keep raw device notes, user agent, source/runtime provenance and session/process diagnostics local.

### Five-minute physical-device preflight

For a new deployment or a regression that warrants another endurance run, use this short check first. The existing project's preflight is already accepted:

1. Restart the updated server and close/reopen the installed PWA to load the new controls. For endurance, use a fixed `pnpm build` / `pnpm start` setup rather than a watching dev server. On macOS, `caffeinate -i pnpm start` prevents idle sleep while the server runs; keep the computer plugged in with its lid open. Preserve your trusted HTTPS configuration.
2. On the test iPhone, start a prepared scene through its speaker or intended output. Select **5-minute check**, enter the iPhone model, iOS version and output device, then tap **Start recording**. Verify the recording title and increasing complete-sample count.
3. Lock the screen and leave playback uninterrupted for at least five minutes. Listen before locking and after unlocking; note any audible gaps. Return to **Recent recordings**. Expect **completed**, roughly five minutes observed, matching complete/total sample counts (normally 61/61), and **No issues detected in sampled telemetry**. Download the summary.
4. Separately, start another five-minute check and intentionally pause from the lock screen for about fifteen seconds. Verify silence and the page’s paused/ready-to-play status, then resume. Tap **Stop recording** and confirm audio keeps playing. This run should be **interrupted**, with pause/idle issues; those are expected for this deliberate control check.
5. Close/reopen the PWA and confirm both summaries remain accessible. Reopening does not automatically resume audio. Report any missing summaries, collection errors, unexpected interruptions or audible gaps before starting the overnight run.

For the overnight run, start playback, select **8-hour recording**, then verify the first samples before locking the phone. Disable the audio device's own sleep timer. Let recording finish automatically. Retain the summary and your listening/control observations separately; the five-minute preflight does not pass the overnight gate.

For inference-during-playback evidence, use a freshly generated scene and begin recording as soon as playback starts. A layered scene may expand its pools early, then reuse them indefinitely; simple mode can request optional events at its normal cadence. Watch **Planner calls** and **New audio recordings** in the summary. Zero new recordings means this run did not demonstrate fresh sound generation during recording; cache reuse is not inference. Do not alter planner cadence or force generation for the endurance run. Separate Ollama/GPU allocation remains outside this recorder's resource measurements.

### Terminal alternative

Obtain the session ID from the page's `?session=...` URL, then run the recorder on the server computer using the same configuration/data directory:

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

The project's transport, Bluetooth and endurance checks below have passed. Use this reference for a new environment or a reported regression; remaining release checks are listed once in [PLAN.md](PLAN.md#remaining-v01-checks).

Connect the phone to the same trusted network as the server and use its reachable address. Use trusted HTTPS for installed-app checks.

1. Prepare a scene, start playback, connect the intended audio device, and lock the phone. Listen across several clip transitions.
2. Pause from the lock screen. With no other listeners, verify idle status, stopped rendering, no producer PID, and a frozen scene clock. Resume playback.
3. Disconnect the network without pausing. After the idle timeout, verify that rendering stops. Reconnect and check recovery.
4. For endurance testing, record eight hours of active playback on a locked physical iPhone with the soak recorder; the built-in speaker is sufficient. Bluetooth playback and controls are checked separately with short interaction checks. A separate Bluetooth endurance run is not required; follow up on reported Bluetooth issues.
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
