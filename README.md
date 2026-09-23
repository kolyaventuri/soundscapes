# Soundscapes

A local procedural soundscape generator for sleep. The intended system combines reusable ambient beds, sparse locally planned/generated events, and continuous HLS playback on an iPhone.

**Current state: Phase 1 playback prototype.** A local pink-noise fixture plays through live AAC/HLS with session controls, independent listeners, and automatic idle shutdown. Session persistence, scene creation, and AI ambience are not implemented. [SPEC.md](SPEC.md) defines v0.1; [PLAN.md](PLAN.md) tracks implementation and acceptance evidence separately.

## Run locally

Use your shell-configured Node.js **24 LTS** (at least 24.12) and **pnpm 10.29.3**. The repository does not switch Node versions automatically. Prefer the latest Node 24 LTS patch; the initial environment has 24.12.0. TypeScript 5.9 and XO 1.2 are selected for compatibility with that environment and React linting; keep the lockfile for reproducible installs.

```sh
pnpm install
pnpm fixture:create
pnpm audio:smoke
pnpm dev
```

Install FFmpeg and ffprobe on your `PATH` first (for example, `brew install ffmpeg` on macOS). The verified host runs FFmpeg/ffprobe **9.0.2**. `fixture:create` synthesizes a deterministic 60-second, 44.1 kHz stereo WAV using quiet, filtered pink noise under `data/assets/fixtures/`. It uses no downloaded recording or model. The smoke test checks that the installed FFmpeg supports the required AAC/HLS operations.

Open [localhost:5173](http://localhost:5173), choose **Prepare test stream**, then use the audio player's Play control. Vite proxies `/api` to Fastify on port 3000. Both bind to `0.0.0.0` for trusted home-LAN development; a phone can use the host's LAN address and port 5173. No models, SQLite setup, or Docker are needed for this phase.

Stop with Ctrl-C. The command starts a shared-package compiler watcher, the server watcher, and Vite. It builds shared contracts before starting the apps.

For a single-origin production build:

```sh
pnpm build
pnpm start
```

Open [localhost:3000](http://localhost:3000). Fastify serves the built web client and API. Run the build again after source changes. `/api/health` reports process connectivity and `static-streaming`; session status reports audio readiness.

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

Preparing a session renders three approximately 6-second segments, then stops FFmpeg until playback starts. Playback loops the fixture as 128 kbps stereo AAC in MPEG-TS HLS. The live playlist keeps ten segments; FFmpeg retains ten additional removed segments for lagging clients and publishes completed files atomically. Each restart uses a new run directory and sequence numbers; at most the current and previous runs are retained.

Each browser gets its own listener ID. Sharing the page URL lets another browser join the same session, with independent playback and pause controls. Playback is not synchronized. The prototype allows four sessions and sixteen listeners per session; **Stop session** ends it for everyone and removes its files.

An explicit pause stops rendering when nobody else is listening. Status polling, playlist polling, HEAD requests, old-run segments, and requests after an explicit pause do not extend listener activity. Successful current-run segment GETs extend the watchdog. A timed-out listener can reactivate through a playlist request without foreground JavaScript; an explicitly paused listener requires Play. Active elapsed time freezes while idle.

The client prefers native HLS and includes HLS.js for browsers requiring Media Source Extensions. Media Session metadata and play/pause/stop handlers are installed where supported. The user has confirmed loading, streaming, continued locked-screen playback, and “Quiet pink noise” / “Soundscapes” lock-screen metadata on a physical iPhone 15. The user also confirms Bluetooth sleep-bud playback while locked, lock-screen pause with server idle, and listener expiry 90 seconds after disabling Wi-Fi. A user-supplied debug response confirms post-expiry idle state, zero listeners, stopped rendering, and no producer PID. Lock-screen controls and manual resume after reconnect, preserving the session ID, are also user-confirmed. Automatic playback recovery after reconnect is not claimed.

Sessions are in memory and do not survive a server restart. Normal stop/shutdown removes owned session files; recovery and orphan cleanup after a hard crash belong to Phase 2. Preparation and resume are bounded to 20 seconds, with errors shown in the UI. This fixture establishes transport behavior; it is not a seamless multi-bed mixer or a test of generated sleep ambience.

## Development checks and diagnostics

```sh
pnpm check       # XO, strict type checks, Vitest, production build
pnpm lint:fix    # Apply XO's automatic fixes
pnpm test:watch  # Interactive Vitest
pnpm audio:smoke # Real FFmpeg AAC/HLS encode, probe, and decode
pnpm audio:integration # Real HTTP stream and session lifecycle check
```

The 18 Vitest tests cover contracts/routes, validation, static serving, initialization, multiple listeners, pause/stop races, stale requests, elapsed time, watchdog/reconnect, retention, and renderer failures. They do not need FFmpeg. The two audio commands require FFmpeg/ffprobe and clean up their temporary outputs. `audio:integration` starts its own temporary server, decodes the HTTP stream, checks frozen output after pause, resumes, verifies a watchdog accelerated to four seconds, reconnects, and checks stop cleanup.

For a session ID from the page's `?session=...` URL, open `/api/debug/sessions/<id>` on the same server origin. It shows state, `rendering`, `producerPid`, active elapsed time, and each listener's consumption age. Normal logs record lifecycle transitions without routine per-segment request logging. The watchdog currently logs a generic `event: "idle"` with `msg: "Session lifecycle"` at info level, not a message named "watchdog". `expired` is a listener state; after the last listener expires, confirm the top-level `status: "idle"`, `rendering: false`, and `producerPid: null`. Inspect this endpoint from the Mac while the phone is disconnected. If another listener remains active, rendering correctly continues. An info-level lifecycle message will be hidden if `LOG_LEVEL` is set to warn, error, fatal, or silent.

`pnpm check` currently passes. The production build reports a bundle-size warning from the full HLS.js fallback; reducing that bundle is a later optimization. Desktop Chrome native HLS was verified through play, pause, resume, and stop. The embedded Codex preview crashed on playback; use regular Safari or Chrome for playback testing. The HLS.js fallback itself has not received browser acceptance yet.

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

Keep the app factory free of listening side effects so tests can use Fastify injection; close it to release session resources. Keep Node/filesystem/model dependencies out of the shared package. Add scheduler, assets, persistence, and provider modules when their phases begin.

Runtime files live under ignored `data/` and `models/` directories. Do not commit generated audio, model weights, SQLite databases, HLS segments, local environment files, or logs.

## Next milestone and prerequisites

Next is persistent procedural ambience (Phase 2). Physical transport behavior has passed; retain the remaining run-metadata follow-up in PLAN.md.

- **PWA foundation only:** a manifest and SVG icon exist; install icons, service-worker behavior, and on-device installation remain in the plan. LAN HTTP does not provide the secure context needed by service workers; decide and document local HTTPS when implementing that layer. See [MDN's service-worker prerequisites](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers).
- **Models:** validate hardware, license, available durations, and generation speed before choosing a sound worker. A short-effects model must not be assumed to produce a 90-second ambient bed.

Docker/OrbStack can be introduced if a worker or deployment needs it. Native development is the initial path, so GPU/model runtime choices remain open.
