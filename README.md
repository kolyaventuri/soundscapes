# Soundscapes

A local procedural soundscape generator for sleep. The intended system combines reusable ambient beds, sparse locally planned/generated events, and continuous HLS playback on an iPhone.

**Current state: Phase 3 local scene and event planning.** A local Ollama model parses scene descriptions and proposes sparse, reviewed library events over four procedural air beds. Events mix into future PCM without blocking continuous AAC/HLS playback. SQLite preserves scenes, clocks, listener IDs, bed selections, event history, and opportunity timing across normal restarts. Scene-specific generated audio is Phase 4. Contextual listening and long-duration acceptance remain open. [SPEC.md](SPEC.md) defines v0.1; [PLAN.md](PLAN.md) tracks implementation and acceptance evidence separately.

## Run locally

Use your shell-configured Node.js **24 LTS** (at least 24.12) and **pnpm 10.29.3**. The repository does not switch Node versions automatically. Prefer the latest Node 24 LTS patch; the initial environment has 24.12.0. TypeScript 5.9 and XO 1.2 are selected for compatibility with that environment and React linting; keep the lockfile for reproducible installs.

```sh
pnpm install
pnpm ambience:create
pnpm audio:smoke
pnpm dev
```

Install FFmpeg and ffprobe on your `PATH` first (for example, `brew install ffmpeg` on macOS). The verified host runs FFmpeg/ffprobe **9.0.2**. `ambience:create` synthesizes four deterministic 90-second, 44.1 kHz stereo WAVs under `data/assets/ambience/`, analyzes/normalizes their levels, and registers them in SQLite. They are subtle variations of filtered pink noise, not recordings or model-generated environments. `pnpm fixture:create` still creates the original single-bed fixture for transport regression tests. The smoke test checks that the installed FFmpeg supports the required AAC/HLS operations.

Open [localhost:5173](http://localhost:5173), choose **Prepare test stream**, then use the audio player's Play control. Vite proxies `/api` to Fastify on port 3000. Both bind to `0.0.0.0` for trusted home-LAN development; a phone can use the host's LAN address and port 5173. Leaving the scene description blank needs no model or Docker. Prompt-based scenes use the local planner setup below. SQLite initializes automatically using Node 24’s built-in `node:sqlite`; Node 24.12 emits its expected experimental-feature warning.

Stop with Ctrl-C. The command starts a shared-package compiler watcher, the server watcher, and Vite. It builds shared contracts before starting the apps.

For a single-origin production build:

```sh
pnpm build
pnpm start
```

Open [localhost:3000](http://localhost:3000). Fastify serves the built web client and API. Run the build again after source changes. `/api/health` reports process connectivity and `local-event-planning`; session status reports audio readiness.

## Configuration

Defaults work without an environment file. To customize, copy `.env.example` to `.env` at the repository root. The server loads that file in development and production; existing shell variables take precedence. Vite reads the same root environment for its proxy. Never put secrets in `VITE_*` variables, which are exposed to the client.

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | API listen address; use `127.0.0.1` for loopback only. |
| `PORT` | `3000` | API / production web port. |
| `LOG_LEVEL` | `info` | Fastify log level. |
| `DATA_DIR` | `data` | Managed files; relative paths resolve from the repository root. |
| `FFMPEG_PATH` | `ffmpeg` | FFmpeg executable name or absolute path. |
| `FFPROBE_PATH` | `ffprobe` | ffprobe executable used by audio verification. |
| `IDLE_TIMEOUT_SECONDS` | `90` | Time without successful current-run segment requests before a listener expires (10–300). |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Loopback HTTP origin only; never a hosted inference endpoint. |
| `OLLAMA_MODEL` | `qwen3:8b` | Downloaded local instruction model. |
| `PLANNER_TIMEOUT_SECONDS` | `45` | Scene/event request deadline (1–120 seconds); failures do not stop active ambience. |
| `EVENT_SKIP_PROBABILITY` | `0.25` | Intentional skip probability before invoking the model. |
| `EVENT_DELAY_SCALE` | `1` | Multiplier for opportunity delays (0.05–10); reduce only for development. |
| `EVENT_DELAY_BUCKETS` | Spec distribution | Optional JSON array of `{weight, minimumSeconds, maximumSeconds}`; weights must sum to 1. |
| `API_PROXY_TARGET` | `http://127.0.0.1:<PORT>` | Optional development proxy override. |

The example explicitly sets the proxy target; update it if you change the API port. Vite uses port 5173 and fails if it is occupied instead of silently switching ports. These services are for a trusted LAN; do not forward them to the internet.

## Local scene and event planner

The selected runtime is **Ollama 0.34.3 with Qwen3 8B Q4_K_M** (`qwen3:8b`, tested digest prefix `500a1f067a9f`). Ollama uses the [MIT license](https://github.com/ollama/ollama/blob/main/LICENSE); [Qwen3 weights use Apache 2.0](https://github.com/QwenLM/Qwen3#license). The [model download](https://ollama.com/library/qwen3:8b) is about 5.23 GB. Native Apple Silicon execution works on the measured M4 / 24 GiB host; Docker is unnecessary for this phase.

From the repository root, start the runtime in a separate terminal:

```sh
brew install ollama  # Already installed on the development Mac
OLLAMA_HOST=127.0.0.1:11434 OLLAMA_MODELS="$PWD/models/ollama" \
  OLLAMA_NUM_PARALLEL=1 OLLAMA_MAX_LOADED_MODELS=1 OLLAMA_NO_CLOUD=1 ollama serve
```

Keep that terminal open. In another terminal at the repository root:

```sh
ollama pull qwen3:8b  # Already downloaded into this repo's ignored models directory
pnpm event:fixture   # Optional 12-second synthetic breeze for plumbing/listening tests
pnpm planner:smoke  # Real local scene, null, and library-proposal checks
pnpm dev
```

The pull command talks to the running server; its `OLLAMA_MODELS` determines storage. These commands deliberately disable Ollama cloud features. Use only downloaded local models. There is no hosted-provider fallback. Stop the app and runtime with Ctrl-C after testing. Existing blank-prompt sessions continue to work with no Ollama server.

Enter a scene such as **“Central Park, New York City, October 1932, around 1 AM. Cool autumn night, light wind, no rain. Sparse distant activity. Intended for sleep.”** Choose **Prepare scene**, wait for preparation, then tap Play. The original description and validated scene are visible at `/api/debug/sessions/<id>`. Missing runtime/model and invalid scene responses produce a visible initialization error. Unspecified calendar components default to January 1, year 2000, 01:00; explicitly supplied parts take precedence. Scene-local wall time is represented in UTC, without a timezone conversion. All scenes still use the same four air beds.

For a quick development check, use `EVENT_DELAY_SCALE=0.05 EVENT_SKIP_PROBABILITY=0 pnpm dev` to accelerate opportunities 20×. Events still enter future audio, so allow a couple of minutes after a proposal. Repeat suppression remains 30 minutes per asset; with only the synthetic breeze, later proposals will usually be null. Use default timing for sparse-activity listening and unattended acceptance.

The software picks opportunities independently: 20% at 1–2 minutes, 45% at 2–5, 25% at 5–10, and 10% at 10–15, then deliberately skips 25%. At most one request runs across all sessions; occupied opportunities are skipped. Requests use constrained JSON, disabled thinking, a 45-second deadline, and [`keep_alive: 0`](https://docs.ollama.com/api/chat) to unload after use. Pause, watchdog idle, Stop, and shutdown cancel pending event work. A model result never controls event frequency or blocks PCM refill.

Only reviewed, scene-compatible local assets may be scheduled. Software independently rejects unknown assets, mismatched categories, unsafe descriptions, and excessive duration/prominence; it limits events to 2–30 seconds and prominence ≤0.2. The last 30 scheduled events are persisted atomically with session/asset changes. An asset cannot repeat within 30 minutes; its category cannot repeat within 10 minutes. Planning uses simulated time, weather, ambient bed titles, elapsed time, library metadata, restrictions, and history. Null is valid. Empty or fully filtered libraries leave only ambience.

Events receive conservative gain, one-second fades, small stereo attenuation, and a 3.5 kHz low-pass filter. Scheduling reserves a slot beyond prepared/in-flight PCM and the immutable encoder boundary—usually about 90–150 seconds ahead—so an opportunity is not an immediate audible event. Pending events retain ten minutes of past audio, with a hard limit of 32. Failed optional WAV mixing retries the bed alone and records `event-mix-error`; malformed, timed-out, or late model responses are discarded.

On 2026-09-23, the final three real-model calls took **19.4 s** for the scene, **8.2 s** for empty-library null, and **11.9 s** for a valid breeze proposal. Peak sampled Ollama-reported allocation was **6.17 GiB**, including Metal allocation; this is not total host memory. A real cancelled request released the adapter and unloaded the model. The smaller Qwen3 4B used about 3.59 GiB and parsed in 12.5 s, but repeatedly misclassified suitable assets in the initial prompt trials. These are a small local evaluation, not a broad model-quality benchmark. `planner:smoke` saves exact outputs and measurements under ignored `data/planner-checks/`; rerun it after changing the model/runtime. Tags can change on a future pull.

### Bring a reviewed WAV

Listen to the complete source clip first and confirm no speech, music, startling transients, nearby alarms/animals, or dramatic weather shifts. Numeric level checks cannot establish that. Use a licensed local WAV, 2–30 seconds, below 24 MiB, with metadata like:

```json
{
  "title": "Gentle breeze through leaves",
  "category": "leaves",
  "tags": ["woodland", "light wind", "subtle"],
  "source": "Your recording or source URL and license",
  "reviewedSleepSafe": true
}
```

```sh
pnpm event:import --file /absolute/breeze.wav --metadata /absolute/breeze.json
```

Categories are `wind`, `leaves`, `water`, `insects`, `distant-footsteps`, and `distant-wheels`. Import copies the audio into managed storage, converts to stereo 44.1 kHz PCM, normalizes to approximately −40 dBFS RMS, and rejects excessive crest/level/duration. Set `reviewedSleepSafe` only after listening. New imports enter the bounded 64-asset planner catalog on the next new session or resume. `event:fixture` is an idempotent synthetic pink-noise breeze, not a reviewed field recording or proof of perceptual comfort.

## Playback and session lifecycle

Preparing an ambience session mixes 90 seconds of future PCM and publishes three approximately 6-second HLS segments, then stops processing until playback starts. Playback uses one continuous 128 kbps stereo AAC encoder in MPEG-TS HLS, fed with bounded PCM chunks. The live playlist keeps ten segments; FFmpeg retains ten additional removed segments for lagging clients and publishes completed files atomically. Each restart uses a new run directory and sequence numbers; at most the current and previous runs are retained.

Each browser gets its own listener ID. Sharing the page URL lets another browser join the same session, with independent playback and pause controls. Playback is not synchronized. The prototype allows four sessions and sixteen listeners per session; **Stop session** ends it for everyone and removes its files.

An explicit pause stops rendering when nobody else is listening. Status polling, playlist polling, HEAD requests, old-run segments, and requests after an explicit pause do not extend listener activity. Successful current-run segment GETs extend the watchdog. A timed-out listener can reactivate through a playlist request without foreground JavaScript; an explicitly paused listener requires Play. Active elapsed time freezes while idle.

The client prefers native HLS and includes HLS.js for browsers requiring Media Source Extensions. Media Session metadata and play/pause/stop handlers are installed where supported. The user has confirmed loading, streaming, continued locked-screen playback, and “Quiet pink noise” / “Soundscapes” lock-screen metadata on a physical iPhone 15. The user also confirms Bluetooth sleep-bud playback while locked, lock-screen pause with server idle, and listener expiry 90 seconds after disabling Wi-Fi. A user-supplied debug response confirms post-expiry idle state, zero listeners, stopped rendering, and no producer PID. Lock-screen controls and manual resume after reconnect, preserving the session ID, are also user-confirmed. Automatic playback recovery after reconnect is not claimed.

Sessions live in `data/soundscapes.sqlite` with versioned migrations. Normal server shutdown stops processing and saves sessions as idle; restarting preserves their IDs, listener IDs, simulated time, and future bed selections. The original Phase 1 in-memory sessions cannot be recovered after their old process exits. Explicit **Stop session** remains terminal and removes its HLS/temp files.

A server ownership lock prevents two servers from rendering or cleaning up the same data directory. Restart recovery discards orphaned UUID session/run folders and unfinished PCM, validates saved state, and rebuilds missing playlists with bounded preparation. A missing or invalid asset needed by a timeline becomes a visible preparation error; regenerate the local fixtures and start a new session. SQLite checkpoints active time once per second; after a hard crash, up to about one second of clock progress can be lost. Downtime never advances the simulated clock.

PCM output is bounded by an exact sample count and a file-size backstop, including fractional resume positions. Each mixer subprocess has a 30-second timeout and encoder readiness has a 20-second deadline. Errors are surfaced in the player; pause/stop waits for mixer cancellation and encoder exit. These are locally synthesized test beds, not a test of generated sleep ambience.

## Ambience, buffering, and test volume

Selection uses seeded weighted randomness, favors beds absent from recent history, and avoids immediate repeats when more than one asset is available. The seed, timeline, placeholder scene, and usage metadata are saved. A single available bed is an explicit degraded fallback; an empty library fails with setup instructions. Crossfades use equal-power 15-second envelopes, with FFmpeg applying them at absolute timeline positions so chunk boundaries do not reset fades.

The controller renders 30-second PCM chunks toward 90 seconds ahead, with a 45-second minimum and 180-second ceiling. Normal refill settles around 90–120 seconds ahead. At most one mixer job runs per session; one PCM chunk (about 5.3 MB) is held in JavaScript for feeding the encoder. The scheduler retains ten minutes of selection history and the bounded future plan. HLS retention and the four-session limit also bound disk/process use.

`playbackCursorMs` is a server active-time estimate, not an exact measurement of a phone’s speaker position. `renderedUntilMs` includes prepared PCM; `committedUntilMs` is the immutable boundary once a chunk starts entering the AAC encoder. Future event mixing must stay beyond that boundary. Idle freezes the scene clock and cancels further mixing/encoding; resume rebuilds future audio from saved timeline state. Blank-prompt test sessions start at 01:00 UTC on 2000-01-01; prompt-based scenes use their parsed calendar.

Playback now has a fixed **4× amplitude boost (about +12 dB)** for testing, with a final peak limiter at 0.25 amplitude (about −12 dBFS). New ambience beds are normalized to approximately −36 dBFS RMS before this boost. This changes future encoder runs; pause/resume or create a new stream to hear it. User-configurable gain remains deferred. Perceptual comfort still requires listening on the actual sleep buds.

## Development checks and diagnostics

```sh
pnpm check       # XO, strict type checks, Vitest, production build
pnpm lint:fix    # Apply XO's automatic fixes
pnpm test:watch  # Interactive Vitest
pnpm audio:smoke # Real FFmpeg AAC/HLS encode, probe, and decode
pnpm audio:integration # Original fixture HTTP/lifecycle regression
pnpm audio:mixer # Crossfade/event PCM continuity, optional failure, fractional resume
pnpm audio:phase2 # Ambience HTTP playback, buffers, lifecycle, and restart
pnpm audio:phase3 # Real HLS overlay, planner failure/null, repeat filtering, restart
pnpm planner:smoke # Real local model; requires the configured Ollama server/model
```

The Vitest tests cover contracts/routes, validation, static serving, initialization, multiple listeners, pause/stop races, stale requests, elapsed time, watchdog/reconnect, retention, renderer failures, SQLite/ownership recovery, an eight-hour simulated bed schedule, and monitoring aggregation/rotation/alerts/read-only polling. Additional tests cover scene/calendar validation, local-only configuration, malformed/oversized/truncated planner responses, weighted opportunity timing, sleep restrictions, history persistence/rollback, cancellation, and late-result rejection. They do not need FFmpeg or a model. The audio commands require FFmpeg/ffprobe and clean up their temporary outputs. `audio:integration` starts its own temporary server, decodes the HTTP stream, checks frozen output after pause, resumes, verifies a watchdog accelerated to four seconds, reconnects, and checks stop cleanup. `audio:phase2` additionally creates four beds, decodes 105 seconds of HLS by default, samples buffer bounds, checks retained segment/PCM counts, and verifies playback after a normal restart. Its watchdog is accelerated to 30 seconds. `audio:mixer` compares split PCM chunks against a continuous reference through a crossfade and checks one-second RMS variation. `audio:mixer` also checks event mixing across a chunk boundary, optional missing-WAV fallback, and 24 fractional resume positions with exact-length, non-silent PCM. `audio:phase3` decodes 145 seconds with a synthetic event, mock-planner failure/nulls, repeat filtering, and persisted scene/history/opportunity state across restart. Model behavior is tested separately by `planner:smoke`. These numeric checks do not establish perceived comfort or overnight reliability.

For a longer isolated decoder run (requires the Mac to remain awake):

```sh
AUDIO_TEST_SECONDS=10800 pnpm audio:phase2
```

This runs three hours of decoding plus lifecycle checks and cleans up its temporary data. It is not a physical iPhone or Bluetooth test.

For a session ID from the page's `?session=...` URL, open `/api/debug/sessions/<id>` on the same server origin. It shows state, `rendering`, `producerPid`, playback/render/commit cursors, buffer bounds, PCM queue depth, selected beds, simulated time, and each listener’s consumption age. It also exposes the parsed scene, scheduled events, planning counters/model, next opportunity, and active planner request. `modelsLoaded.llm` is `null` because request state does not prove actual model residency; inspect Ollama `/api/ps` for that. Event opportunity/skip/schedule/mix-failure messages enter the same diagnostic journal. Normal logs record lifecycle transitions without routine per-segment request logging. The watchdog now logs `event: "listener-expired"` with the timeout reason, followed by `event: "idle"` when the last listener expires. Both use `msg: "Session lifecycle"` at info level. `expired` is a listener state; after the last listener expires, confirm the top-level `status: "idle"`, `rendering: false`, and `producerPid: null`. Inspect this endpoint from the Mac while the phone is disconnected. If another listener remains active, rendering correctly continues. An info-level lifecycle message will be hidden if `LOG_LEVEL` is set to warn, error, fatal, or silent.

`pnpm check` currently passes 53 tests, lint, type checks, and production builds. The production build reports a bundle-size warning from the full HLS.js fallback; reducing that bundle is a later optimization. Desktop Chrome native HLS was verified through play, pause, resume, and stop. The embedded Codex preview crashed on playback; use regular Safari or Chrome for playback testing. The HLS.js fallback itself has not received browser acceptance yet.

## Record an unattended playback run

Use a fixed production build for tonight's run. Stop your development server first if it owns port 3000 or the same data directory, then run in one terminal:

```sh
pnpm build
pnpm start
```

On the iPhone, open `http://<Mac-LAN-IP>:3000`, prepare/resume the ambience stream, and start playback. Copy the session UUID from the page's `?session=...` URL. In another terminal on the **same Mac**, from this repository:

```sh
caffeinate -i pnpm soak:record --session YOUR_SESSION_UUID --hours 8 --device "iPhone 15; iOS version; Safari; sleep-bud model"
```

Replace the UUID and device notes with the actual values. `caffeinate -i` prevents idle system sleep while recording; keep the Mac powered and its lid open. Lock the phone and leave playback running. Do not restart/rebuild the server during the test. The recorder neither starts nor stops the server and does not start audio playback.

Defaults: poll every **30 seconds**, stop after **8 hours**, API origin `http://127.0.0.1:3000` (or configured `PORT`). Override with `--interval 60`, `--hours 10`, or `--url http://127.0.0.1:PORT`; `pnpm soak:record --help` lists all options. It loads the same `.env`/`DATA_DIR` as the server and verifies host/data-directory identity before measuring local processes and files. Start the updated server before using this command; an older server lacks `/api/debug/monitoring`.

The printed output directory is `data/soaks/<timestamp>-<unique suffix>/` (under your configured `DATA_DIR`). It contains:

- **`summary.md`**: readable progress/morning report, including issues and first/last/min/max/mean measurements. Updated atomically after every sample.
- **`summary.json`**: full-run aggregates, completion state, sample counts, and log-rotation counts.
- **`manifest.json`**: duration, interval, device notes, host/runtime versions, source revision/dirty state, build-entry timestamp, FFmpeg version, and initial server configuration, including planner model/deadline/opportunity settings. Source revision describes the recorder checkout; it does not certify the running server binary.
- **`samples.jsonl` / `events.jsonl`**: timestamped debug/resource measurements and deduplicated lifecycle/error events. Each retains three files of at most 4 MiB (current, `.1`, `.2`), about **24 MiB total logs per run**. Full-run aggregates survive rotation. Separate runs remain until you remove their directories.

Measurements include active buffer depth, playback/render/commit cursors, listeners/consumption ages, scheduled beds/events, opportunity/skip counters, active planner requests, PCM queue, Node RSS/heap/CPU, sampled FFmpeg descendant RSS/CPU, and session HLS/PCM counts/bytes. Only debug GETs are made: recording never fetches playlists/segments, renews activity, creates listeners, or resumes playback. Polling continues through server outages and records failures; Ctrl-C writes an interrupted summary and leaves playback alone.

The summary flags out-of-bounds buffers, stalled clock/encoder progress, absent producers, unexpected idle/stop/expiry, server errors/restarts, sample/journal gaps, stale bed history, and excessive/growing retention. Intentional pauses also produce review flags. These are diagnostic thresholds, not automatic acceptance criteria. Exit code 0 means the duration completed with no detected issues; 2 means review flags or interruption; 1 means recorder failure. A hard kill/power loss leaves the most recent report marked `recording`; do not treat that as a completed run.

The server's diagnostic journal holds its last 128 lifecycle/error events in memory, independently of `LOG_LEVEL`. Crashes can lose details since the last poll; overflow/restarts are flagged. Keep terminal output available for fatal startup/process errors. Short mixer processes between samples can be missed, FFmpeg CPU is the platform `ps` estimate, and measurements cover all server descendants/sessions. Disk measurements cover the selected session, excluding the reusable library, database, and recorder files. The independently started Ollama server is outside the app process tree: the soak recorder does not measure its RSS/GPU allocation. Its request activity and decisions are recorded; real model allocation is sampled separately by `planner:smoke`. Do not interpret app/FFmpeg RSS as total inference memory. Run only the test session for the clearest resource attribution.

In the morning, inspect `summary.md`, note whether audio is still audible and the lock-screen controls still work, then stop recording/playback/server as appropriate. Record any audible gaps, device/network changes, or deliberate pauses with approximate times. A quiet report proves only sampled server health; physical listening/Bluetooth acceptance and the final integrated eight-hour gate remain separate.

## iPhone and Bluetooth acceptance

Keep the Mac awake and connect the iPhone to the same trusted LAN. Start `pnpm dev`, find the Mac's current LAN address (on macOS, `ipconfig getifaddr en0` for Wi-Fi), and open `http://<LAN-IP>:5173` in Safari. The address recorded during development was `192.168.4.64`; it may change. `soundscape.local` and port-80 routing are not configured.

1. Prepare a stream, start playback with a tap, and connect the Bluetooth sleep buds. Open the debug endpoint from the Mac for server evidence.
2. Lock the phone and listen for at least 10–15 minutes. Check that playback continues and segment-consumption age stays below 90 seconds.
3. Pause from the lock screen or Control Center. With no other listeners, confirm `status: idle`, `rendering: false`, `producerPid: null`, and an unchanged active elapsed time. Resume and confirm audio and rendering return.
4. Disconnect the phone's network while playing, without pressing Pause. Wait at least 90 seconds after its last segment request; confirm idle and no producer. Restore the connection and observe recovery.
5. Stop the session and confirm its directory under `data/sessions/` disappears. Stop the development processes with Ctrl-C when finished.

Record iPhone model, iOS/browser version, Bluetooth device, duration, stalls, controls, and server evidence in `PLAN.md`. Loading, streaming, locked-screen Bluetooth playback, metadata, pause to idle, 90-second listener expiry, and post-expiry producer shutdown have passed on the user's iPhone 15, along with lock-screen resume and manual resume after reconnect in the same session. All Phase 1 physical behavior checks now pass; iOS/browser version, sleep-bud model, and duration remain to record. The eight-hour overnight gate is separate.

## Repository layout

```text
apps/web/          React + Vite player, manifest, development API proxy
apps/server/       Fastify API, sessions, FFmpeg renderer, fixture and test CLIs
packages/shared/   Browser-safe Zod schemas and inferred API types
PLAN.md            Ordered checklists, release gates, and verification evidence
SPEC.md            Full product specification
```

Keep the app factory free of listening side effects so tests can use Fastify injection; close it to release session resources. Keep Node/filesystem/model dependencies out of the shared package. Keep mixing in `ambience/`, encoding in `audio/`, registration in `assets/`, and SQLite access in `persistence/`. Local planning adapters live in `planning/`; sound-generation adapters come later.

Runtime files live under ignored `data/` and `models/` directories. Do not commit generated audio, model weights, SQLite databases, HLS segments, local environment files, or logs.

## Next milestone and prerequisites

Phase 3 implementation and automated checks are in place; contextual event listening is still pending. Phase 4 sound-generation work can proceed while that acceptance is collected. Several-hour resource measurements and the remaining locked-screen/Bluetooth/disconnect/reconnect checks with the mixer remain open; use the soak recorder above. Do not call v0.1 complete until long-run acceptance passes, including the final eight-hour physical-device run with the integrated application. Configurable volume remains a later UX item.

- **PWA foundation only:** a manifest and SVG icon exist; install icons, service-worker behavior, and on-device installation remain in the plan. LAN HTTP does not provide the secure context needed by service workers; decide and document local HTTPS when implementing that layer. See [MDN's service-worker prerequisites](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers).
- **Models:** validate hardware, license, available durations, and generation speed before choosing a sound worker. A short-effects model must not be assumed to produce a 90-second ambient bed.

Docker/OrbStack can be introduced if a worker or deployment needs it. The planner uses native Ollama; the sound-generation worker/runtime remains to be selected.
