# Soundscapes

A local procedural soundscape generator for sleep. The intended system combines reusable ambient beds, sparse locally planned/generated events, and continuous HLS playback on an iPhone.

**Current state: development scaffold.** The web client connects to a working Fastify health endpoint. Scene creation, audio playback, persistence, and AI adapters are tracked in [PLAN.md](PLAN.md) and are not implemented yet. [SPEC.md](SPEC.md) defines v0.1.

## Run locally

Use your shell-configured Node.js **24 LTS** (at least 24.12) and **pnpm 10.29.3**. The repository does not switch Node versions automatically. Prefer the latest Node 24 LTS patch; the initial environment has 24.12.0. TypeScript 5.9 and XO 1.2 are selected for compatibility with that environment and React linting; keep the lockfile for reproducible installs.

```sh
pnpm install
pnpm dev
```

Open [localhost:5173](http://localhost:5173). Vite proxies `/api` to Fastify on port 3000. Both bind to `0.0.0.0` for trusted home-LAN development; a phone can use the host's LAN address and port 5173. No models, FFmpeg, SQLite setup, or Docker are needed to run this scaffold.

Stop with Ctrl-C. The command starts a shared-package compiler watcher, the server watcher, and Vite. It builds shared contracts before starting the apps.

For a single-origin production build:

```sh
pnpm build
pnpm start
```

Open [localhost:3000](http://localhost:3000). Fastify serves the built web client and API. Run the build again after source changes. `/api/health` reports process connectivity and the scaffolding stage, not audio/model readiness.

## Configuration

Defaults work without an environment file. To customize, copy `.env.example` to `.env` at the repository root. The server loads that file in development and production; existing shell variables take precedence. Vite reads the same root environment for its proxy. Never put secrets in `VITE_*` variables, which are exposed to the client.

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | API listen address; use `127.0.0.1` for loopback only. |
| `PORT` | `3000` | API / production web port. |
| `LOG_LEVEL` | `info` | Fastify log level. |
| `API_PROXY_TARGET` | `http://127.0.0.1:<PORT>` | Optional development proxy override. |

The example explicitly sets the proxy target; update it if you change the API port. Vite uses port 5173 and fails if it is occupied instead of silently switching ports. These services are for a trusted LAN; do not forward them to the internet.

## Development checks

```sh
pnpm check       # XO, strict type checks, Vitest, production build
pnpm lint:fix    # Apply XO's automatic fixes
pnpm test:watch  # Interactive Vitest
```

The initial integration test checks the shared health contract, static web serving, missing API responses, and configuration rejection. Audio/scheduler/model tests belong with their implementations. Physical iPhone, Bluetooth, background playback, and overnight reliability require the separate acceptance checks in `PLAN.md`.

## Repository layout

```text
apps/web/          React + Vite UI, manifest, development API proxy
apps/server/       Fastify app factory, entry point, configuration, integration tests
packages/shared/   Browser-safe Zod schemas and inferred API types
PLAN.md            Ordered checklists, release gates, and verification evidence
SPEC.md            Full product specification
```

Keep the app factory free of listening/process side effects so tests can use Fastify injection. Keep Node/filesystem/model dependencies out of the shared package. Add audio, sessions, scheduler, assets, persistence, and provider modules when their phases begin; the plan defines those boundaries without empty placeholder implementations.

Runtime files will live under ignored `data/` and `models/` directories. Do not commit generated audio, model weights, SQLite databases, HLS segments, local environment files, or logs.

## Next milestone and prerequisites

Start with a known local WAV → FFmpeg → HLS → native iPhone audio, then prove locked-screen Bluetooth playback and explicit/stream-watchdog pause detection before AI work.

- **FFmpeg is currently broken on the initial host:** it references missing `libx265.216.dylib`. Repair the local FFmpeg/x265 installation and verify both `ffmpeg -version` and `ffprobe -version` before starting the audio milestone. No system packages were changed during scaffolding.
- **PWA foundation only:** a manifest and SVG icon exist; install icons, service-worker behavior, and on-device installation remain in the plan. LAN HTTP does not provide the secure context needed by service workers; decide and document local HTTPS when implementing that layer. See [MDN's service-worker prerequisites](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers).
- **LAN naming:** `soundscape.local` and port-80 routing are not configured by this scaffold. Use the host's LAN address with the documented port until discovery/routing is implemented.
- **Models:** validate hardware, license, available durations, and generation speed before choosing a sound worker. A short-effects model must not be assumed to produce a 90-second ambient bed.

Docker/OrbStack can be introduced if a worker or deployment needs it. Native development is the initial path, so GPU/model runtime choices remain open.
