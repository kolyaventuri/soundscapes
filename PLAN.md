# v0.1 implementation plan

[SPEC.md](SPEC.md) is the product specification. This file tracks delivery; checked boxes mean completed work with evidence, not intended behavior. Keep implementation, automated verification, listening checks, and physical iPhone acceptance separate. Update the relevant checklist and evidence as each small Conventional Commit lands.

## Scope and decisions

- Adopt the spec's recommended React + TypeScript + Vite client, Node.js + TypeScript + Fastify server, and pnpm workspace with a shared contracts package.
- Use XO, Vitest, strict TypeScript, SQLite metadata, filesystem audio storage, and FFmpeg for audio processing. Select the SQLite driver when persistence is implemented.
- Run natively first. Docker/OrbStack is available if a concrete runtime need arises; model runtimes and GPU access must be evaluated on the actual host before selecting a worker deployment.
- Prefer native Safari HLS through an HTML audio element. Keep the UI and API on one origin. Make Media Session controls part of early transport validation.
- Freeze simulated time while idle. Keep event timing in software, validate model proposals, and keep ambience independent of inference.
- Keep AI behind replaceable local adapters. Do not select/download models or build AI integration before the transport/lifecycle gate passes.
- No accounts, cloud AI, WAN deployment, synchronized multiplayer, native mobile app, microphone input, music generation, or vector database in v0.1 (spec §3).

## Phase 0 — Development foundation

Spec: §4, §41–45, §49–51.

- [x] Create `apps/web`, `apps/server`, and `packages/shared` as a pnpm workspace; commit a lockfile.
- [x] Add strict TypeScript, XO, Vitest, and root development/build/check commands.
- [x] Add a React starter screen and manifest foundation with honest availability states; do not present unimplemented scene creation as working.
- [x] Add a Fastify health endpoint and shared runtime-validated API contract.
- [x] Support same-origin API requests through the Vite development proxy and serve the built client from Fastify.
- [x] Validate server configuration, shut down cleanly, and ignore local data, model weights, secrets, and generated outputs.
- [x] Document setup, commands, repository boundaries, and current limitations; update `AGENTS.md` for the chosen stack.
- [x] Run lint, type checks, tests, build, and development/production smoke checks; inspect the actual browser screen.

Exit: a fresh checkout can run `pnpm install` and `pnpm dev`, and the browser can reach the API. This is scaffolding, not an audio milestone.

## Phase 1 — Static HLS and minimal session control

Spec: §7, §22–26, §30, §35, §39–41, milestone 1 in §46.

- [x] Repair/verify local FFmpeg and ffprobe, including AAC encoding and HLS output. Record versions and reproducible setup.
- [x] Add one known, licensed local WAV fixture or a documented fixture-import command; keep large audio out of Git.
- [x] Define validated session requests/responses and the `initializing`, `active`, `idle`, `stopped`, `error` state machine. Start with an in-memory session repository.
- [x] Define initialization versus listener demand: bound initial preparation, enable ongoing work only for listeners, and never leave abandoned initialization generating indefinitely.
- [x] Implement session status, play, pause, and stop routes with idempotent controls and invalid-transition handling. Use the fixture explicitly until scene generation exists.
- [x] Loop the fixture through managed FFmpeg subprocesses into AAC and a sliding live HLS playlist (start with 6-second segments).
- [x] Serve playlists/segments under validated session IDs; set content types and cache behavior, reject traversal, publish completed segments atomically, and clean up old segments/processes.
- [x] Add native `<audio>` playback with user-gesture start, loading/failure states, pause/resume/stop, and supported Media Session metadata/actions.
- [x] Implement explicit playback signals and an independent stream-consumption watchdog (90 seconds by default). Status polling alone must not count as listening.
- [x] Cover prefetch/stale requests after explicit pause, absent clients, reconnects, and multiple listeners without claiming synchronized playback.
- [x] Verify pause or loss of consumption stops rendering and queued work; stop also cleans up session resources. Resume re-buffers without requiring browser JavaScript to stay alive.
- [x] Verify access from a physical iPhone; document the temporary LAN hostname/IP and port. The user reports loading and streaming on an iPhone 15. `soundscape.local` discovery and port routing remain planned in Phase 5.

**Required physical-device gate before AI work:**

- [x] On a physical iPhone, load the stream and confirm playback continues when the screen is locked (user-reported iPhone 15 result).
- [x] Confirm lock-screen metadata displays “Quiet pink noise” by “Soundscapes” (user-reported).
- [x] Confirm locked-screen playback through Bluetooth sleep buds (user-reported iPhone 15 result; device model and duration still to record).
- [x] Confirm lock-screen pause → server idle (user-reported).
- [x] Confirm lock-screen resume → playback (user reports lock-screen controls work as expected).
- [x] Disconnect Wi-Fi without sending pause; confirm the listener expires after 90 seconds (user-reported).
- [x] Confirm after expiry that the session is idle, `rendering: false`, and `producerPid: null` with no other listeners (user-supplied debug response).
- [x] Restore connectivity after expiry and manually resume playback in the same session (user confirms session ID is preserved).
- [ ] Record iPhone/iOS/browser/audio-device details, test duration, observed behavior, and server evidence below.

All Phase 1 physical behavior checks have passed through user reports and supplied server evidence. Reconnect was validated with manual resume; automatic reconnect playback is not claimed. Run metadata (iOS/browser version, sleep-bud model, and duration) remains to record; overnight acceptance remains separate.

Physical test steps and the debug endpoint are documented in [README.md](README.md#iphone-and-bluetooth-acceptance). The development LAN address was `192.168.4.64:5173`; verify the current address and reachability from the actual phone.

## Phase 2 — Persistent procedural ambience

Spec: §6, §10–11, §15–16, §20–21, §26–33, §38, milestones 2–3 in §46.

- [x] Add SQLite migrations and repositories for sessions, assets, and events; persist timeline/scene state and usage metadata needed to resume.
- [x] Create managed `data/assets/{ambience,events}` and `data/sessions/<id>/{hls,temp}` storage; define restart recovery, missing-file handling, and cleanup ownership.
- [x] Register four compatible local ambience fixtures with measured duration, sample rate, channels, and source metadata.
- [x] Normalize/analyze every asset before it is playable; enforce peak/transient limits and prevent clipping in the final mix.
- [x] Select beds with weighted randomness, recent-use bias, and no immediate repeat; handle an empty pool and degraded single-bed fallback explicitly.
- [x] Build a continuous 44.1 kHz stereo timeline with 10–20 second crossfades and similar loudness across beds. Use FFmpeg argument arrays, never shell interpolation.
- [x] Track playback position separately from rendering position; maintain 45-second minimum, 90-second target, and 180-second maximum future audio.
- [x] Define a commit boundary for encoded audio so future events cannot modify already-published segments; prioritize ambience over optional work.
- [x] Bound PCM memory, HLS/temp disk usage, controller concurrency, and retained history. Preserve segments long enough for lagging clients before cleanup.
- [x] Implement a 1:1 simulation clock that freezes while idle and resumes from stored scene state; recover safely after a normal restart.
- [x] Expose debug session state: buffer, queue, next opportunity, active bed, model state, and last stream-consumption age. Keep routine per-segment logging off.
- [x] Unit-test selection/state/clock/watchdog behavior using injected time and randomness. Integration-test HLS continuity, pause/resume, cleanup, and FFmpeg failure.
- [ ] Listen through crossfades and run several hours of fixture playback with bounded memory/disk and no gaps; repeat the iPhone transport gate.

Implementation and short-run checks are complete. Multi-hour resource stability, listening quality, and the repeat iPhone gate remain open.

Exit: an unattended, persistent ambient stream works without any AI dependency.

## Phase 3 — Event scheduling and local LLM planning

Spec: §8, §12–15, §19, §28–29, §34–35, §43–45, milestone 4 in §46. Depends on the physical-device gate and stable ambience.

- [ ] Select and document a local LLM runtime/model after measuring host compatibility, resource use, licensing, setup, and latency; define adapter timeouts/cancellation.
- [ ] Parse arbitrary prompts into a schema-validated scene; preserve the original prompt and expose clear initialization errors.
- [ ] Implement configurable irregular opportunity delays: 20% at 1–2 min, 45% at 2–5 min, 25% at 5–10 min, 10% at 10–15 min, plus intentional skipped opportunities.
- [ ] Give the planner scene/weather/clock/elapsed time/ambient state/restrictions/library summary and recent history. Validate at most one proposal or an encouraged null result.
- [ ] Enforce sleep-mode restrictions independently of the LLM, including speech, startling transients, close alarms/sirens, and abrupt weather changes; bound duration/prominence.
- [ ] Persist/filter approximately 30–60 minutes or 20–30 recent events to discourage repetition; record events when scheduled for playback, not merely proposed.
- [ ] Use manually supplied event WAVs first; apply gain, fades, and restrained panning/filtering into mutable future audio.
- [ ] Keep planning off the buffer-refill path. Drop invalid, failed, or late proposals and continue ambience; do not shift the opportunity clock based on LLM preference.
- [ ] Test delay distribution/bounds, history filtering, malformed/null/rejected proposals, timeouts, late results, and continued playback during model failure.
- [ ] Listen for contextual plausibility, sparse activity, and lack of perceptible periodicity.

## Phase 4 — Local sound generation and initial scene creation

Spec: §4, §9, §16–21, §27–29, §34–35, milestone 5 in §46.

- [ ] Evaluate Stable Audio 3 Small-SFX or an equivalent local model: availability/license, hardware/memory requirements, supported duration/sample rate, and measured generation speed. Document the chosen adapter and fallback decision.
- [ ] Resolve how the selected model supplies four compatible 60–120 second beds; do not assume a short-SFX model can generate 90-second ambience directly.
- [ ] Define `SoundGenerator` requests/results and a local worker protocol with readiness, timeout, cancellation, and validated managed output paths; keep Python details outside the controller.
- [ ] Generate four contextual ambience beds, analyze/normalize/register them, and build sufficient future audio before playback becomes ready.
- [ ] Implement a bounded generation queue with one sound job at a time, ambience priority, per-session ownership, and event deadlines.
- [ ] Search existing assets before generation; generate only when no acceptable match exists. Include both scene context and the desired event in prompts.
- [ ] Quarantine incomplete/unprocessed outputs; validate file size, decodeability, duration, channels, sample rate, peaks, and transient limits before registration/mixing.
- [ ] Ignore/drop stale results after idle/stop or missed deadlines; cancel queued/in-flight work where supported and verify no new inference is dispatched while idle.
- [ ] Retain loaded models briefly if useful; make the optional 30-minute model-unload policy configurable without losing session/asset data.
- [ ] Prove model installation is the only network-dependent step and runtime uses no cloud AI APIs; test with external networking unavailable.
- [ ] Verify failed generation, invalid audio, worker crash, and slow inference do not interrupt established ambience; distinguish startup failure when no usable beds exist.

## Phase 5 — Reuse and complete playback UX

Spec: §16–18, §23–24, §30, §39–44, milestone 6 in §46.

- [ ] Implement tag/context matching, recency, usage-count/rarity weighting, small randomness, and a configurable reuse threshold; exclude incompatible scenes and unsafe assets.
- [ ] Update usage metadata only for selected/scheduled assets and add restrained gain/pan/EQ/fade/crop variations without aggressive pitch artifacts.
- [ ] Test scoring, reuse-versus-generate decisions, recently used exclusions, missing assets, and mixer parameter bounds.
- [ ] Complete prompt/sleep-mode creation, progress, scene/weather/simulation clock, native player controls, and optional recent-event display in the sparse mobile UI.
- [ ] Add user-adjustable playback level compatible with iPhone/Bluetooth, with conservative defaults and output limiting. The user reported the original pink-noise fixture was VERY quiet through sleep buds. A fixed +12 dB test boost is now applied; configurable gain remains deferred.
- [ ] Add asset/debug views or API routes for diagnosis; keep detailed diagnostics out of the main sleep experience. Saved scene browsing is optional.
- [ ] Finish install icons, manifest, and app-shell behavior. Decide/document trusted local HTTPS for service workers: plain LAN HTTP is not a secure context. Never cache HLS playlists/segments or activity-sensitive APIs in a service worker.
- [ ] Configure/document mDNS and the final LAN entry point, including any port or local reverse proxy. Verify on the actual iPhone rather than inferring reachability from localhost.
- [ ] Show repeat sessions reuse appropriate assets and reduce generation frequency; listen for objectionable repetitions and volume variance.

## Phase 6 — Overnight acceptance and v0.1 handoff

Spec: §2, §21, §25–29, §41, §45, §47, §51.

- [ ] Complete automated coverage of session creation, bed registration, HLS output, pause/resume/stop, watchdog, asset reuse, null proposals, and model/FFmpeg failures.
- [ ] Exercise request/model schemas, ID/path traversal rejection, bounded input/output sizes, subprocess argument safety, and trusted-LAN-only configuration.
- [ ] Run the Central Park 1932 example end to end using real local models and four generated beds; record readiness time and steady-state inference/resource use.
- [ ] Verify irregular subtle events, valid null decisions, generated/reused assets, future mixing, and ambience continuing through event failures.
- [ ] Complete at least one **eight-hour physical iPhone run** with locked screen and Bluetooth sleep buds; record stalls, listening observations, buffer levels, memory/disk/CPU/GPU trends, and retained segment counts.
- [ ] Verify lock-screen pause and stream-loss idle separately, no unnecessary inference/rendering while idle, and resume without regenerating the world.
- [ ] Inspect peak/transient analysis and listen to representative generated output/transitions. Do not equate a numeric limiter check with perceptual comfort.
- [ ] Test fresh setup from the README, including local model installation, FFmpeg, LAN hostname, PWA requirements, normal shutdown, and restart recovery.
- [ ] Close temporary browser sessions and processes used for verification; record remaining limitations. Mark v0.1 complete only when all mandatory gates pass.

## Optional after the required path

- [ ] Slow scene mutations over 10–30 minutes with smooth transitions (§36).
- [ ] Gradual replacement of the initial ambience pool (§37).
- [ ] Saved-scene browsing (§30), richer loudness measurements, or additional presentation effects if required by listening results.

These do not block v0.1 and should not displace transport reliability, resource control, or sleep suitability.

## Evidence and current blockers

| Date | Area | Evidence / result | Boundary / next step |
| --- | --- | --- | --- |
| 2026-09-23 | Initial environment | Shell Node `v24.12.0`, pnpm `10.29.3`; repository initially contains only spec and guidance. | Keep the shell-selected Node; advise a current Node 24 LTS patch upgrade. |
| 2026-09-23 | FFmpeg prerequisite | Homebrew FFmpeg fails to load `/opt/homebrew/opt/x265/lib/libx265.216.dylib`. | Historical failure; resolved by the repair recorded below. |
| 2026-09-23 | FFmpeg repair and AAC/HLS | User reinstalled FFmpeg; live checks report FFmpeg/ffprobe `9.0.2`. `pnpm audio:smoke` passes stereo 44.1 kHz AAC, 6-second HLS segmentation, sliding playlist, atomic publication, and decoding. | Resolves the earlier x265 blocker. `pnpm fixture:create` creates a deterministic 60-second pink-noise WAV under ignored `data/`; no downloaded/licensed recording is needed. Physical playback is recorded separately below. |
| 2026-09-23 | Scaffold `29d49d0` | `pnpm install --frozen-lockfile` and `pnpm check` pass: XO, strict workspace/root type checks, 7 Vitest tests, shared/server/web builds. CI workflow added. | CI itself has not run remotely; no audio or model tests yet. |
| 2026-09-23 | Browser/runtime `29d49d0` | `pnpm dev` at `:5173` and `pnpm start` at `:3000` both show the local API connected in the in-app browser, with no captured browser errors/warnings. Inspected desktop and 390×844 layout. | Browser viewport only, not a physical iPhone. No HLS, installed PWA, Bluetooth, or background-playback acceptance. |
| 2026-09-23 | Cleanup | Test tab closed, viewport reset, development/production processes stopped; process inspection found no remaining workspace server/watchers. | No servers intentionally left running. |
| 2026-09-23 | Static stream implementation `8e27ee8`, `7d460ed` | In-memory sessions, bounded preparation, 6-second AAC/HLS segments, atomic publication, bounded run retention, per-listener controls, 90-second watchdog, Media Session hooks, and debug endpoint implemented. | No persistence, models, procedural mixing, or installed PWA. Native controls on an actual iPhone remain unverified. |
| 2026-09-23 | Automated Phase 1 checks | `pnpm check` passes lint, strict types, 18 Vitest tests, and production builds. `pnpm audio:smoke` passes using FFmpeg/ffprobe 9.0.2. `pnpm audio:integration` decodes real HTTP HLS and verifies pause/frozen clock, resume, watchdog idle, reconnect, stop, and removal of session files. | HTTP integration accelerates the watchdog to 4 seconds. Vite reports a bundle-size warning for the full HLS.js fallback. CI has not run remotely. |
| 2026-09-23 | Desktop playback | Regular Chrome reported native HLS; observed advancing playback beyond 2 minutes 40 seconds after resume, with no media error or captured browser errors/warnings. Pause changed the server to idle; resume returned to playback; stop removed the player/session resources. Inspected the 390×844 layout. One active sample contained 25 segments totaling about 2.5 MiB across retained runs. | Short desktop test only, not a physical phone, listening-quality, long-run resource, or Bluetooth result. HLS.js fallback not yet browser-verified. The embedded Codex preview crashed when playback began. |
| 2026-09-23 | Phase 1 device gate | Reproducible Safari/Bluetooth/lock-screen and stream-loss procedure added to README, with per-listener consumption ages and producer PID available at `/api/debug/sessions/<id>`. Physical access, locked-screen playback, and metadata now have user-reported evidence below. | Bluetooth playback, lock-screen pause to idle, and 90-second listener expiry are user-confirmed below. Post-expiry producer shutdown is confirmed by the debug response below. Lock-screen controls and manual resume after reconnect with the same session ID are now confirmed below. All behavior checks pass; complete the remaining run metadata for the acceptance record. |
| 2026-09-23 | Production and cleanup `7d460ed` | `pnpm start` served built HTML, JavaScript, and the `static-streaming` health response through `192.168.4.64:3000` from the host. Temporary development/production servers and FFmpeg renderers stopped; process/port checks found none remaining. Chrome test tab closed and viewport reset. | Host LAN-address access does not prove reachability from an iPhone. No server left running; start `pnpm dev` for device testing. |
| 2026-09-23 | Physical iPhone 15 — user report | User confirms the page loads, the stream plays, and playback continues after locking the device. Lock-screen metadata reads “Quiet pink noise” by “Soundscapes”. | iOS/browser version, exact URL/build, audio output/Bluetooth device, and test duration were not supplied. No pause/resume, watchdog shutdown, server-state, or overnight result claimed. |
| 2026-09-23 | Physical Bluetooth and lifecycle — user report | On the iPhone 15, Bluetooth sleep-bud playback continues with the screen locked. Lock-screen pause works and the server reports idle. Turning off Wi-Fi makes the listener report expired after 90 seconds. The fixture is reported VERY quiet; adjustable playback level is tracked for later. | Resume/reconnect, post-expiry `rendering: false` and `producerPid: null`, iOS/browser version, bud model, and duration remain unreported. Current logs label the watchdog shutdown as a generic `idle` lifecycle event. |
| 2026-09-23 | Physical disconnect watchdog — server evidence supplied by user | Session `a85571b9-e29c-4a98-aa0f-c79574cd45f6` reports `status: idle`, `rendering: false`, `listenerCount: 0`, `producerPid: null`, and one `expired` listener. Configured timeout is 90 seconds; consumption age at capture is 198.706 seconds. This confirms the producer is stopped after disconnect expiry. | Snapshot does not prove resume/reconnect or clock stability over time. `ready: true` retains prepared audio for the session; it does not indicate ongoing rendering. |
| 2026-09-23 | Physical resume and reconnect — user report | User confirms lock-screen controls work as expected. After restoring connectivity, manually resuming audio succeeds and preserves the session ID. This completes the Phase 1 physical behavior checks. | Automatic playback recovery was not demonstrated. iOS/browser version, sleep-bud model, and duration remain unspecified; no overnight acceptance claimed. |
| 2026-09-23 | Test volume `8acff96` | Increased the fixed encoder gain to 4× amplitude (about +12 dB) and retained an output limiter. Original fixture AAC/HLS and HTTP lifecycle checks pass. | Applies to new encoder runs; configurable gain remains deferred. New normalized ambience uses the same gain and limiter. |
| 2026-09-23 | Phase 2 storage and assets `b3c92d0` | Node 24 built-in SQLite, versioned session/asset/event storage, managed server ownership, four locally synthesized 90-second stereo beds, level analysis/normalization, deterministic weighted selection, 15-second crossfades, and bounded history implemented. Beds measured −36 dBFS RMS and −22.9 to −21.0 dBFS peaks before output gain. | `node:sqlite` is experimental on the installed Node 24.12. No external recording or model is used. Placeholder scene clock starts at 01:00 UTC; prompt parsing remains Phase 3. |
| 2026-09-23 | Phase 2 mixer and automated coverage `31131ec` | `pnpm check` passes with 24 Vitest tests. Tests cover an eight-hour simulated scheduler, selection/fallbacks, SQLite restart, frozen downtime, ownership, missing-playlist recovery, and prior lifecycle cases. `pnpm audio:mixer` confirms split chunks match a continuous reference byte-for-byte through a crossfade: 1.50 dB spread across one-second RMS windows, peak −21.0 dBFS. `pnpm audio:smoke` and the original fixture `pnpm audio:integration` pass. | Simulated schedule and numeric continuity do not establish multi-hour playback, perceptual comfort, or phone acceptance. |
| 2026-09-23 | Phase 2 real stream | `AUDIO_TEST_SECONDS=240 pnpm audio:phase2` passes real HTTP AAC decoding across several bed transitions; all 457 samples stayed 89.7–119.6 seconds ahead, within the 45/90/180-second design bounds. PCM/HLS retention, pause, frozen output, resume, watchdog shutdown, HLS reconnect, normal restart, same session/listener IDs, and explicit-stop cleanup pass. | Watchdog accelerated to 30 seconds for the test. Earlier long runs exposed a mixer subprocess failure; one FFmpeg filter-graph worker and subprocess diagnostics were added before this successful run. Longer soak remains required. Playback cursor is a server active-time estimate, not exact per-device speaker position. |
| 2026-09-23 | Phase 2 Chrome and restart | Production build in isolated data directory played native HLS beyond 128 seconds without media error. Pause returned idle. After server restart and page reload, the same session ID resumed and played beyond 79 seconds without media error; no captured browser errors/warnings. Explicit Stop removed the player. Temporary Chrome tab and test server closed. | Desktop browser only. Repeat locked-screen/Bluetooth/pause/disconnect/reconnect acceptance on the physical iPhone with this mixer, and run several hours with resource measurements. |
| 2026-09-23 | Phase 2 cleanup | Temporary browser-test data and mixer reproduction output removed. Process inspection found no remaining test servers, audio integration jobs, or soundscape FFmpeg renderers. Four registered ambience fixtures remain under ignored `data/` for local use. | No server left running. Run `pnpm dev` and prepare a new ambience stream. |

For each acceptance run, append commands/build revision, device/runtime versions, duration, results, and unresolved failures. Do not mark physical-device or overnight checks complete from unit tests, generated playlists, or a desktop preview.
