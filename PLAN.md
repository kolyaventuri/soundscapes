# v0.1 implementation and acceptance plan

[SPEC.md](SPEC.md) defines the product. This is the current checklist; [ACCEPTANCE.md](ACCEPTANCE.md) records evidence and its limits. Checked boxes indicate completed work or explicitly identified superseded requirements. Historical test notes do not create new release gates.

## Current position

Phases 0–5 are implemented. Phase 6 engineering, setup verification, diagnostics and endurance are complete. The user accepts the creek repair, beach volume balance, improved chatter without constant pops, cup recording and preparation feedback. Remaining release work is the four focused checks below and the final handoff decision. There is no outstanding broad scene-fidelity sweep or overnight run.

The app remains pre-v0.1 until those checks are resolved. Advanced layering is an optional prototype; its remaining fidelity and feature work does not block v0.1.

## Remaining v0.1 checks

These are the only active release checks. Existing observations can close them; do not repeat a test just because it appeared in an older phase checklist.

- [ ] **R1 — Simple-mode event listening.** Confirm that occasional events during ordinary, default-cadence playback fit the scene, have appropriate prominence and do not sound mechanically repetitive. Real planning/generation, null decisions, reuse, timing and failure isolation already pass. Representative scene quality and crossfades have been heard; the evidence gap is explicit acceptance of the simple event planner's audible cadence. Null/skipped opportunities are expected. This is normal-use listening, not another soak or forced inference run.
- [ ] **R2 — iPhone Scene level control.** Confirm that moving the app's Scene level control changes the audible level as expected after buffered audio clears and remains comfortable. The control, persistence, limiting and idle behavior pass automated/desktop checks; beach mix balance is accepted. Physical lock-screen, pause/resume and Bluetooth checks need no repetition. Speaker output is sufficient for this control check.
- [ ] **R3 — Rain exclusion follow-up.** On fresh rain output, check the previously violated “no thunder” request. The user already accepted its general scene match and transitions. Text exclusion handling passes, but forwarding the constraint did not prevent generated thunder in the earlier recording. Record the audible result; if it still fails, retain a concrete generation-fidelity issue and document the limitation rather than claiming acoustic compliance. Stronger window patter is optional polish.
- [ ] **R4 — Supported iPhone HTTPS entry point.** Confirm that the chosen certified LAN address opens in Safari without a certificate warning. CA trust, PWA installation and locked-screen playback were user-reported, but warning-free Safari access was not explicitly confirmed. A certified LAN IP is sufficient; universal Bonjour discovery is not a release requirement. Keep portable setup instructions aligned with the verified route.
- [ ] **Release handoff.** Resolve R1–R4, record the release revision and supported setup/known limitations, then mark v0.1 complete. Do not turn optional work or missing early-run metadata into additional release gates.

R2 and R4 can be covered in one brief iPhone UI visit. R1 and R3 are focused listening observations, not a repeat of the five-scene review. If already covered in normal use, record that evidence instead of asking for another run.

## Accepted behavior and listening

- [x] Physical iPhone streaming, screen lock, lock-screen metadata and pause/resume; Bluetooth sleep-bud playback and controls.
- [x] Network-loss expiry, idle state with no renderer/producer, and manual reconnect/resume with the same session. Automatic playback after network recovery is not promised.
- [x] Short physical ambience listening through crossfades and pause/resume.
- [x] Measured eight-hour laptop/browser streaming: 961/961 complete active samples, no recorded issues and bounded resources.
- [x] Eight-hour locked-iPhone speaker playback: 961/961 complete active samples, no recorded issues and user-confirmed normal audio after completion. Physical-device endurance is satisfied.
- [x] Physical PWA installation/playback and five-minute diagnostic preflight, including deliberate pauses. Normal sleep-bud use is accepted separately from measured endurance.
- [x] Preparation feedback: the user considers live progress/estimated readiness done.
- [x] Representative nature, crowd and music scenes were auditioned. Jazz café was the strongest reference; rain broadly matched the request with smooth transitions. Later follow-ups below supersede the initial defect reports, without promising every generated seed will be good.
- [x] Creek: user confirms the scene is fixed. No further phasing/choppiness investigation is pending without a new report.
- [x] Beach: user considers balance checks complete and recent volume balance much better. No repeat balance pass is needed.
- [x] Chatter: the room-distance comparison was approved, followed by improved scene listening without obvious constant pops. No general de-clicking or further pop investigation is pending without new evidence.
- [x] Cup recording: user approves the isolated sound. Frequency across a layered session is separate optional work, not a reason to reopen the recording.
- [x] First-Play freeze: reproduced and repaired in Zen/Firefox-family playback; controls, fresh-session first Play and pause/resume passed the browser retest. Native-HLS startup ordering has automated/desktop coverage. Reopen for a fresh failure report, not a blanket replay.

## Completed implementation by phase

### Phase 0 — Foundation

- [x] Node.js 24 LTS/TypeScript pnpm workspace: React/Vite, Fastify and browser-safe shared schemas.
- [x] XO, Vitest, strict types, build/check scripts, same-origin proxy and compiled app serving.
- [x] Validated configuration, clean shutdown, ignored local data/models/secrets and portable setup. Native execution is supported; Docker is unnecessary for the documented setup.

### Phase 1 — HLS and sessions

- [x] FFmpeg prerequisite repair, fixture creation, stereo AAC/HLS, sliding playlists, atomic publication and bounded segment retention.
- [x] Session/listener states, bounded preparation, Play/Pause/Stop, native audio and Media Session controls, multiple listeners and stale-request handling.
- [x] Consumption watchdog; passive polling does not renew demand, and explicit pause remains idle.
- [x] Physical transport gate completed before AI integration; accepted behavior is listed above.

### Phase 2 — Persistent ambience

- [x] Versioned SQLite/filesystem storage, shutdown recovery, same-session resume, missing-file handling and terminal Stop cleanup.
- [x] Four-bed pool, seeded selection, long crossfades, frozen idle clock, separate render/playback cursors and immutable encoder commit boundary.
- [x] Bounded PCM/HLS retention, timeline pruning, buffers and debug state. Generated audio is normalized/peak-protected with advisory level warnings; malformed/non-finite audio is rejected.
- [x] Real FFmpeg lifecycle/mixer/restart checks and short physical listening. Later laptop and locked-iPhone runs satisfy the earlier multi-hour transport requirement; a fixture-only repeat is superseded.

### Phase 3 — Local planning and events

- [x] Local Ollama/Qwen adapter: constrained JSON, bounded cancellable requests, cloud disabled and unload-after-request.
- [x] Software-owned irregular opportunities, null decisions, context/history filtering, persisted scheduling and future-only event mixing.
- [x] Planning/inference stays off the refill path; invalid, late or failed optional work leaves ambience playing. Sleep mode is opt-in and preserves requested music/crowds.
- [x] Source exclusions checked in inventories, asset reuse and event proposals without banning unrelated category members. Acoustic compliance remains R3; audible simple event cadence remains R1.

### Phase 4 — Local sound generation

- [x] Pinned Stable Audio 3 Medium/Small MLX and Small-SFX/Small-Music PyTorch adapters, separate installation and offline inference; setup credentials are excluded from inference.
- [x] Four generated beds, bounded serial queue, priority/cancellation/deadlines, managed output validation, normalization, registration and worker recovery.
- [x] Environmental captions, source isolation/timing guidance and consistent distance for background chatter; cache identity includes model/runtime/prompt details.
- [x] Real local-model generation, reuse, failure isolation and generation during playback verified. Comparing every smaller model is not required after choosing and validating Medium.

### Phase 5 — Playback UX and reuse

- [x] Context/tag reuse scoring, history/usage weighting, bounded mix variation and passive library/debug access.
- [x] Prompt/sleep-mode creation, live preparation stages, measured readiness, scene details/clock and stream-level control. R2 covers the unrecorded physical control check.
- [x] Install icons/manifest and static-only PWA caching; API/HLS/audio excluded. LAN HTTPS setup documented; R4 covers warning-free physical access.
- [x] Saved-scene search/pagination/previews and independent recipes; all non-stopped sessions visible with Close and Close all.
- [x] Confirmed deletion clears matching prompt variants/sessions, invalidates old cache hits, removes orphaned generated WAVs and preserves shared/imported recordings. SQLite v5 persists exclusions/cleanup retries; an identical prompt generates fresh recordings after deletion and restart.

### Phase 6 — Reliability and handoff

- [x] API/schema/path/subprocess boundaries, model/encoder failures, pause/watchdog recovery and restart verified; deployment limited to a trusted unauthenticated LAN.
- [x] Real Central Park pipeline and event/null/reuse/failure checks. Initial generation and in-playback generation have evidence independent of endurance.
- [x] CLI/PWA diagnostics, bounded server-owned recording/history, passive controls, interruption recovery and downloadable summaries.
- [x] Fresh dependency/Python-runtime/compiled-app setup, SQLite initialization and offline generation using installed weights. A new account/full model download was not repeated; that is a coverage limit.
- [x] Laptop and locked-iPhone endurance accepted. No separate Bluetooth endurance or sustained maximum-inference stress run is required for v0.1.
- [x] Reconcile historical tasks and user feedback into R1–R4 and release handoff. The latest runtime change passed 147 tests, builds and required FFmpeg checks. This reconciliation changes documentation only.

## Optional advanced layering

This prototype is usable but its completion is not a v0.1 release gate.

- [x] Automatically plan requested ambience/music/activity/effects from one prompt, with longer preparation disclosed and per-layer progress; no manual track configuration.
- [x] One HLS output, independent boundaries/seeded clocks, persisted schedules, ongoing sources established together, bounded pools/history and cancellation.
- [x] Source-specific short effect recordings, gains and independent frequent/occasional/rare gaps. Real planning/generation covers café, beach, cruise, rain and band examples; timing is separate from loudness.
- [x] Required/optional failures, incremental expansion, cache/restart and generation during playback verified. Ambience/effects reuse has measured multi-hour coverage; music/activity and sustained inference do not inherit that claim.
- [x] Beach balance and improved café chatter/cup sound accepted; later transitions in the layered review had no obvious cuts.
- [ ] **Targeted layered listening:** confirm rare horns and intermittent espresso/clinks feel appropriately spaced. Preserve accepted balance/recordings; adjust only an identified timing/density problem. This is distinct from R1's simple event planner.
- [ ] **Source and music fidelity:** improve residual source leakage, acoustics, requested genre/variety and phrase/key/tempo continuity where listening identifies a problem. Later planner checks stopped injecting jazz into Caribbean music; old captions do not prove the current planner still does so. Intelligible dialogue/lyrics are not promised.
- [ ] **Broader advanced-mode acceptance:** before presenting layering as complete, assess the chosen music/activity setup for repetition/transitions and multi-hour behavior. Sustained inference stress is optional performance work; do not reopen accepted application endurance.

## Later feature work

- [ ] Slow scene mutations over 10–30 minutes with smooth transitions (spec §36).
- [ ] Gradual replacement of the initial ambience pool (spec §37).
- [ ] Longer music segments or continuation if needed for coherence; evaluate before independently generating individual instruments.
- [ ] Additional loudness analysis, ducking or presentation effects only when listening identifies a need.

## Retired or consolidated items

| Earlier item | Current disposition |
| --- | --- |
| Several-hour fixture-only run; repeated mixer/device transport matrix | Superseded by short fixture/mixer checks and accepted eight-hour laptop/locked-iPhone runs. |
| Separate extended Bluetooth run | Not required; playback/controls and normal use passed. |
| Recover every early iOS/browser/sleep-bud detail | Missing metadata stays documented; it does not invalidate accepted behavior or require reenactment. |
| Repeat five scenes, creek diagnosis, beach balance, chatter investigation | Review completed and reported repairs accepted; only specific unresolved checks above remain. |
| Mandatory Small-SFX versus Medium comparison | Model-selection exploration, not a remaining release requirement. |
| Fixed Bonjour name or privileged reverse proxy | A reachable certified LAN address suffices. Warning-free access is R4; universal discovery is not promised. |
| Eight hours of continuous model inference | Not a v0.1 gate. Real short inference/stream overlap and brief concurrent generation during phone endurance already have evidence. |
| Duplicate phase listening/level/HTTPS boxes | Consolidated into R1–R4; close each once rather than reopening it from historical notes. |

Exact run artifacts and pre-reconciliation logs remain under ignored `data/`; prior tracked checklists remain in Git history. Public evidence and reproducible commands are in [ACCEPTANCE.md](ACCEPTANCE.md) and [README.md](README.md).
