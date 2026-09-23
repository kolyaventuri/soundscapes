# Soundscapes

A local procedural soundscape generator for sleep. The intended system combines reusable ambient beds, sparse locally planned/generated events, and continuous HLS playback on an iPhone.

**Current state: Phase 2 procedural ambience.** Four normalized local beds rotate with 15-second crossfades through live AAC/HLS. SQLite preserves sessions, listener IDs, scene/clock state, bed selections, and asset usage across normal restarts. Prompt-driven scene creation and AI are not implemented. Long-duration and repeat iPhone acceptance remain open. [SPEC.md](SPEC.md) defines v0.1; [PLAN.md](PLAN.md) tracks implementation and acceptance evidence separately.

## Run locally

Use your shell-configured Node.js **24 LTS** (at least 24.12) and **pnpm 10.29.3**. The repository does not switch Node versions automatically. Prefer the latest Node 24 LTS patch; the initial environment has 24.12.0. TypeScript 5.9 and XO 1.2 are selected for compatibility with that environment and React linting; keep the lockfile for reproducible installs.

```sh
pnpm install
pnpm ambience:create
pnpm audio:smoke
pnpm dev
```

Install FFmpeg and ffprobe on your `PATH` first (for example, `brew install ffmpeg` on macOS). The verified host runs FFmpeg/ffprobe **9.0.2**. `ambience:create` synthesizes four deterministic 90-second, 44.1 kHz stereo WAVs under `data/assets/ambience/`, analyzes/normalizes their levels, and registers them in SQLite. They are subtle variations of filtered pink noise, not recordings or model-generated environments. `pnpm fixture:create` still creates the original single-bed fixture for transport regression tests. The smoke test checks that the installed FFmpeg supports the required AAC/HLS operations.

Open [localhost:5173](http://localhost:5173), choose **Prepare test stream**, then use the audio player's Play control. Vite proxies `/api` to Fastify on port 3000. Both bind to `0.0.0.0` for trusted home-LAN development; a phone can use the host's LAN address and port 5173. No models or Docker are needed. SQLite initializes automatically using Node 24’s built-in `node:sqlite`; Node 24.12 emits its expected experimental-feature warning.

Stop with Ctrl-C. The command starts a shared-package compiler watcher, the server watcher, and Vite. It builds shared contracts before starting the apps.

For a single-origin production build:

```sh
pnpm build
pnpm start
```

Open [localhost:3000](http://localhost:3000). Fastify serves the built web client and API. Run the build again after source changes. `/api/health` reports process connectivity and `procedural-ambience`; session status reports audio readiness.

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
| `API_PROXY_TARGET` | `http://127.0.0.1:<PORT>` | Optional development proxy override. |

The example explicitly sets the proxy target; update it if you change the API port. Vite uses port 5173 and fails if it is occupied instead of silently switching ports. These services are for a trusted LAN; do not forward them to the internet.

## Playback and session lifecycle

Preparing an ambience session mixes 90 seconds of future PCM and publishes three approximately 6-second HLS segments, then stops processing until playback starts. Playback uses one continuous 128 kbps stereo AAC encoder in MPEG-TS HLS, fed with bounded PCM chunks. The live playlist keeps ten segments; FFmpeg retains ten additional removed segments for lagging clients and publishes completed files atomically. Each restart uses a new run directory and sequence numbers; at most the current and previous runs are retained.

Each browser gets its own listener ID. Sharing the page URL lets another browser join the same session, with independent playback and pause controls. Playback is not synchronized. The prototype allows four sessions and sixteen listeners per session; **Stop session** ends it for everyone and removes its files.

An explicit pause stops rendering when nobody else is listening. Status polling, playlist polling, HEAD requests, old-run segments, and requests after an explicit pause do not extend listener activity. Successful current-run segment GETs extend the watchdog. A timed-out listener can reactivate through a playlist request without foreground JavaScript; an explicitly paused listener requires Play. Active elapsed time freezes while idle.

The client prefers native HLS and includes HLS.js for browsers requiring Media Source Extensions. Media Session metadata and play/pause/stop handlers are installed where supported. The user has confirmed loading, streaming, continued locked-screen playback, and “Quiet pink noise” / “Soundscapes” lock-screen metadata on a physical iPhone 15. The user also confirms Bluetooth sleep-bud playback while locked, lock-screen pause with server idle, and listener expiry 90 seconds after disabling Wi-Fi. A user-supplied debug response confirms post-expiry idle state, zero listeners, stopped rendering, and no producer PID. Lock-screen controls and manual resume after reconnect, preserving the session ID, are also user-confirmed. Automatic playback recovery after reconnect is not claimed.

Sessions live in `data/soundscapes.sqlite` with versioned migrations. Normal server shutdown stops processing and saves sessions as idle; restarting preserves their IDs, listener IDs, simulated time, and future bed selections. The original Phase 1 in-memory sessions cannot be recovered after their old process exits. Explicit **Stop session** remains terminal and removes its HLS/temp files.

A server ownership lock prevents two servers from rendering or cleaning up the same data directory. Restart recovery discards orphaned UUID session/run folders and unfinished PCM, validates saved state, and rebuilds missing playlists with bounded preparation. A missing or invalid asset needed by a timeline becomes a visible preparation error; regenerate the local fixtures and start a new session. SQLite checkpoints active time once per second; after a hard crash, up to about one second of clock progress can be lost. Downtime never advances the simulated clock.

Each mixer subprocess has a 30-second timeout and encoder readiness has a 20-second deadline. Errors are surfaced in the player; pause/stop waits for mixer cancellation and encoder exit. These are locally synthesized test beds, not a test of generated sleep ambience.

## Ambience, buffering, and test volume

Selection uses seeded weighted randomness, favors beds absent from recent history, and avoids immediate repeats when more than one asset is available. The seed, timeline, placeholder scene, and usage metadata are saved. A single available bed is an explicit degraded fallback; an empty library fails with setup instructions. Crossfades use equal-power 15-second envelopes, with FFmpeg applying them at absolute timeline positions so chunk boundaries do not reset fades.

The controller renders 30-second PCM chunks toward 90 seconds ahead, with a 45-second minimum and 180-second ceiling. Normal refill settles around 90–120 seconds ahead. At most one mixer job runs per session; one PCM chunk (about 5.3 MB) is held in JavaScript for feeding the encoder. The scheduler retains ten minutes of selection history and the bounded future plan. HLS retention and the four-session limit also bound disk/process use.

`playbackCursorMs` is a server active-time estimate, not an exact measurement of a phone’s speaker position. `renderedUntilMs` includes prepared PCM; `committedUntilMs` is the immutable boundary once a chunk starts entering the AAC encoder. Future event mixing must stay beyond that boundary. Idle freezes the scene clock and cancels further mixing/encoding; resume rebuilds future audio from saved timeline state. The placeholder simulated scene starts at 01:00 UTC on 2000-01-01 until prompt-based scene creation is implemented.

Playback now has a fixed **4× amplitude boost (about +12 dB)** for testing, with a final peak limiter at 0.25 amplitude (about −12 dBFS). New ambience beds are normalized to approximately −36 dBFS RMS before this boost. This changes future encoder runs; pause/resume or create a new stream to hear it. User-configurable gain remains deferred. Perceptual comfort still requires listening on the actual sleep buds.

## Development checks and diagnostics

```sh
pnpm check       # XO, strict type checks, Vitest, production build
pnpm lint:fix    # Apply XO's automatic fixes
pnpm test:watch  # Interactive Vitest
pnpm audio:smoke # Real FFmpeg AAC/HLS encode, probe, and decode
pnpm audio:integration # Original fixture HTTP/lifecycle regression
pnpm audio:mixer # Exact PCM continuity and crossfade level checks
pnpm audio:phase2 # Ambience HTTP playback, buffers, lifecycle, and restart
```

The 32 Vitest tests cover contracts/routes, validation, static serving, initialization, multiple listeners, pause/stop races, stale requests, elapsed time, watchdog/reconnect, retention, renderer failures, SQLite/ownership recovery, an eight-hour simulated bed schedule, and monitoring aggregation/rotation/alerts/read-only polling. They do not need FFmpeg. The audio commands require FFmpeg/ffprobe and clean up their temporary outputs. `audio:integration` starts its own temporary server, decodes the HTTP stream, checks frozen output after pause, resumes, verifies a watchdog accelerated to four seconds, reconnects, and checks stop cleanup. `audio:phase2` additionally creates four beds, decodes 105 seconds of HLS by default, samples buffer bounds, checks retained segment/PCM counts, and verifies playback after a normal restart. Its watchdog is accelerated to 30 seconds. `audio:mixer` compares split PCM chunks against a continuous reference through a crossfade and checks one-second RMS variation. These numeric checks do not establish perceived comfort or overnight reliability.

For a longer isolated decoder run (requires the Mac to remain awake):

```sh
AUDIO_TEST_SECONDS=10800 pnpm audio:phase2
```

This runs three hours of decoding plus lifecycle checks and cleans up its temporary data. It is not a physical iPhone or Bluetooth test.

For a session ID from the page's `?session=...` URL, open `/api/debug/sessions/<id>` on the same server origin. It shows state, `rendering`, `producerPid`, playback/render/commit cursors, buffer bounds, PCM queue depth, selected beds, simulated time, and each listener’s consumption age. Model/next-event fields explicitly show that inference and event scheduling are absent. Normal logs record lifecycle transitions without routine per-segment request logging. The watchdog now logs `event: "listener-expired"` with the timeout reason, followed by `event: "idle"` when the last listener expires. Both use `msg: "Session lifecycle"` at info level. `expired` is a listener state; after the last listener expires, confirm the top-level `status: "idle"`, `rendering: false`, and `producerPid: null`. Inspect this endpoint from the Mac while the phone is disconnected. If another listener remains active, rendering correctly continues. An info-level lifecycle message will be hidden if `LOG_LEVEL` is set to warn, error, fatal, or silent.

`pnpm check` currently passes. The production build reports a bundle-size warning from the full HLS.js fallback; reducing that bundle is a later optimization. Desktop Chrome native HLS was verified through play, pause, resume, and stop. The embedded Codex preview crashed on playback; use regular Safari or Chrome for playback testing. The HLS.js fallback itself has not received browser acceptance yet.

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
- **`manifest.json`**: duration, interval, device notes, host/runtime versions, source revision/dirty state, build-entry timestamp, FFmpeg version, and initial server configuration. Source revision describes the recorder checkout; it does not certify the running server binary.
- **`samples.jsonl` / `events.jsonl`**: timestamped debug/resource measurements and deduplicated lifecycle/error events. Each retains three files of at most 4 MiB (current, `.1`, `.2`), about **24 MiB total logs per run**. Full-run aggregates survive rotation. Separate runs remain until you remove their directories.

Measurements include active buffer depth, playback/render/commit cursors, listeners/consumption ages, scheduled beds, PCM queue, Node RSS/heap/CPU, sampled FFmpeg descendant RSS/CPU, and session HLS/PCM counts/bytes. Only debug GETs are made: recording never fetches playlists/segments, renews activity, creates listeners, or resumes playback. Polling continues through server outages and records failures; Ctrl-C writes an interrupted summary and leaves playback alone.

The summary flags out-of-bounds buffers, stalled clock/encoder progress, absent producers, unexpected idle/stop/expiry, server errors/restarts, sample/journal gaps, stale bed history, and excessive/growing retention. Intentional pauses also produce review flags. These are diagnostic thresholds, not automatic acceptance criteria. Exit code 0 means the duration completed with no detected issues; 2 means review flags or interruption; 1 means recorder failure. A hard kill/power loss leaves the most recent report marked `recording`; do not treat that as a completed run.

The server's diagnostic journal holds its last 128 lifecycle/error events in memory, independently of `LOG_LEVEL`. Crashes can lose details since the last poll; overflow/restarts are flagged. Keep terminal output available for fatal startup/process errors. Short mixer processes between samples can be missed, FFmpeg CPU is the platform `ps` estimate, and measurements cover all server descendants/sessions. Disk measurements cover the selected session, excluding the reusable library, database, and recorder files. GPU measurement is deferred until inference exists. Run only the test session for the clearest resource attribution.

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

Keep the app factory free of listening side effects so tests can use Fastify injection; close it to release session resources. Keep Node/filesystem/model dependencies out of the shared package. Keep mixing in `ambience/`, encoding in `audio/`, registration in `assets/`, and SQLite access in `persistence/`. Provider adapters come later.

Runtime files live under ignored `data/` and `models/` directories. Do not commit generated audio, model weights, SQLite databases, HLS segments, local environment files, or logs.

## Next milestone and prerequisites

Phase 3 event-planning development can proceed after the successful short iPhone ambience/crossfade/pause/resume check. Several-hour resource measurements and the remaining locked-screen/Bluetooth/disconnect/reconnect checks with the mixer remain open; use the soak recorder above. Do not call v0.1 complete until long-run acceptance passes, including the final eight-hour physical-device run with the integrated application. Configurable volume remains a later UX item.

- **PWA foundation only:** a manifest and SVG icon exist; install icons, service-worker behavior, and on-device installation remain in the plan. LAN HTTP does not provide the secure context needed by service workers; decide and document local HTTPS when implementing that layer. See [MDN's service-worker prerequisites](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers).
- **Models:** validate hardware, license, available durations, and generation speed before choosing a sound worker. A short-effects model must not be assumed to produce a 90-second ambient bed.

Docker/OrbStack can be introduced if a worker or deployment needs it. Native development is the initial path, so GPU/model runtime choices remain open.
