# v0.1 verification record

This record summarizes completed checks and their limits. [PLAN.md](PLAN.md#remaining-v01-checks) is the sole current release checklist: R1 and R3 remain open, R2 and R4 are accepted, and the handoff decision follows. Earlier investigations are preserved in Git history and raw local artifacts under ignored `data/`; historical “pending” statements are superseded by the current status here.

The reconciliation introduced no runtime changes, new listening claims or new overnight requirements. Automated, real-model, browser and physical-listening evidence remain distinct.

## Current acceptance status

| Area | Evidence and current status |
| --- | --- |
| HLS and lifecycle | Real FFmpeg AAC/HLS, bounded buffers/retention, pause, stale requests, watchdog expiry, reconnect, Stop and normal restart pass. |
| Physical transport | User-confirmed iPhone loading/streaming, lock-screen metadata, locked playback, Bluetooth sleep buds, pause/resume and manual same-session recovery after network loss. |
| Measured endurance | Eight-hour laptop/browser and eight-hour locked-iPhone speaker runs both completed 961/961 complete active samples with no recorded issues. Endurance is accepted. |
| Local inference during playback | Real scene/event generation and layer-pool expansion pass with ongoing HLS; the phone endurance record also contains brief successful generation for another session. Continuous maximum model load is not claimed or required for v0.1. |
| Preparation and PWA | User accepts live preparation feedback, installed PWA playback and the five-minute diagnostic preflight, including deliberate pauses. The user accepts HTTPS access after successful use on two other devices; revisit the earlier quirk only if it recurs. |
| Audible scene quality | Five-scene review completed. Later feedback accepts the creek repair, beach balance, improved chatter without constant pops and the isolated cup sound. Rain's general scene match/transitions were accepted; its thunder exclusion remains R3. |
| Simple event behavior | Real and controlled tests cover scheduling, null decisions, generation, reuse and failures. Explicit ordinary-cadence listening acceptance remains R1. |
| Scene level control | Numeric limiting, file/PCM input paths, persistence, idle behavior and browser adjustment pass. The user confirms using the Scene level control successfully on iPhone; R2 is accepted. |
| Startup regression | Native-HLS preparation/Play ordering repaired; Zen/Firefox first-Play freeze reproduced and browser-retested successfully. Further investigation is issue-driven. |
| Library/deletion | Search/details/reuse and persistent recipes implemented; deletion now invalidates old audio reuse and removes orphans. Restart and identical-prompt regressions pass. |
| Advanced layering | Automatically planned independent layers are usable, with accepted examples and real generation/streaming evidence. Remaining music, source-isolation and broader music/activity coverage are optional prototype work. |

## Physical playback and endurance

The initial physical iPhone check established stream access, screen-lock continuity, Media Session metadata, Bluetooth sleep-bud output, lock-screen pause/resume and network-loss expiry. A supplied debug response confirmed idle status, stopped rendering and no producer after the 90-second watchdog. The user then resumed manually after reconnecting with the same session. Automatic network recovery without user interaction is not claimed.

A short physical ambience run crossed bed boundaries and passed pause/resume. Later installed-PWA use also passed locked-screen and Bluetooth playback. The user completed the five-minute PWA diagnostic with deliberate pauses and reported no apparent problems; it is a control/preflight pass, not uninterrupted endurance.

A separate normal-use sleep-bud report covered approximately 63 minutes before the buds' own sleep/idle behavior paused playback. This is accepted use/listening evidence, not an eight-hour measurement. Missing early browser versions, exact output model or build identifiers remain historical limitations; they do not invalidate the accepted behavior or require reenactment.

| Measured run | Result | Coverage limit |
| --- | --- | --- |
| Laptop/browser, eight hours | 961/961 complete active samples; zero recorded issues/restarts; bounded server/encoder memory, buffer, PCM queue, session files and HLS retention. Layer histories were pruned as playback advanced. | Existing four-bed/six-effect layered pool; no sound generation during this run. Browser memory and external Ollama/GPU allocation were not measured. |
| Locked iPhone speaker, eight hours | 961/961 complete active samples; zero issues/collection errors; one server/encoder run and bounded resources. User confirmed the screen was locked and audio still played normally after completion. | User identified the device as iPhone 12 / iOS 26. Telemetry cannot independently attribute every consumed segment when multiple listeners are present. |

Both runs used the local Apple Silicon/Node.js 24/FFmpeg 9.0.2 environment. Recorded checkout provenance does not certify which source built a previously running process. Sampling can miss brief client stalls; the user's listening observations are recorded separately rather than inferred from telemetry.

The phone's recorded session reused its existing ambience/effects pool. Time-filtered lifecycle records show six successful audio-generation completions for another session during the same run. This establishes brief concurrent generation without observed stream disruption, not sustained inference or eight-hour simple-event-planner coverage.

**The application endurance gate is complete.** Speaker output satisfies the locked-iPhone requirement. Bluetooth routing, controls and normal use already passed; no separate Bluetooth endurance or fixture-only overnight run is required. The original raw summaries and samples remain under ignored `data/soaks/`.

## Listening review and later resolutions

The original comparative review covered simple forest creek/rain and layered neighborhood café/beach restaurant/jazz café. It found recognizable scenes and generally good later transitions, but also creek phasing, excessive surf, artificial vocal/popping artifacts, dense effect recordings and an odd layered startup. The later observations below determine current status; the original defects are not all still open.

| Observation | Current disposition |
| --- | --- |
| Creek phasing/choppiness | User explicitly confirms the creek scene is fixed. No further diagnosis is pending without a new example. Earlier correlation/join analysis did not establish the cause; listening acceptance does not assert a particular DSP repair. |
| Beach surf too loud/close | User considers balance checks complete and recent beach volume much better. No repeat balance pass or separate shoreline-distance gate is required for that report. |
| Café chatter / constant pops | User approved a controlled room-distance regeneration, then reported improved scene audio with no obvious constant pops after the cache repair. This accepts the auditioned improvement without promising all future seeds. |
| Cup sound | Isolated recording approved. Remaining perceived layered effect frequency is optional follow-up, separate from the accepted sound. |
| Rain at the window | General scene and transitions were accepted. More window patter is optional polish; the earlier audible thunder despite “no thunder” remains R3. |
| Jazz reference / later layered transitions | Jazz café was the strongest initial result; no obvious later cuts were reported for the layered scenes. Retain it as a reference rather than repeating the whole review. |
| Foghorn / espresso / birds treated as continuous beds | Caption/source classification and per-source scheduling repaired and verified with real planning plus unit/integration checks. Layered perceived density/cadence remains a targeted optional check; simple event listening is R1. |
| Caribbean music narrowed to jazz | Later real planner regression no longer adds jazz. Actual genre variety and musical continuation remain optional fidelity work; an earlier bad caption is not evidence of a current planner failure. |

The chatter investigation compared the saved normalized WAV with a regeneration using its original prompt and seed. Their PCM closely matched; transients existed in the raw model output before normalization. Changing only the listening-distance caption produced the user-approved example. The resulting planner guidance preserves explicit nearby/individual/whispered speech and open-air outdoor acoustics. No broad de-clicking, voice filtering or rejection of usable audio based only on level metrics was added.

Creek and chatter raw comparisons remain under ignored `data/fidelity-review/`. Session IDs, file identities, seeds, workstation measurements and detailed prompt chains belong with those local artifacts, not in the portable release checklist.

## Automated and real-model verification

The most recent runtime change, `d7ae271`, passed `pnpm check`: lint, strict types, **147 Vitest tests across 22 files**, and production builds. Existing lint advisories and the Vite HLS.js bundle-size advisory are not test failures. Documentation-only acceptance updates and this reconciliation did not rerun or replace that evidence.

Required real-FFmpeg checks passed for AAC/HLS, lifecycle, mixer continuity, ambience restart/retention, events, generation and layered mixing. The event/generation/layer lifecycle suites use controlled adapters where noted to make failures and cache behavior reproducible; they do not establish model fidelity.

Separate real Ollama/Qwen3 8B and pinned Stable Audio 3 Medium MLX runs verify scene parsing, source inventories, exclusions in text, generated beds/events, initial layered pools, expansion during playback and restart/reuse. A real Central Park run generated four beds and optional events while streaming. Real layered runs decoded 165 seconds, expanded their pools, retained adequate buffer and restored schedules without unnecessary generation. Short accelerated event checks establish integration, not ordinary-cadence listening acceptance.

Numeric format/finite-sample/level checks, bounded normalization and peak protection apply before generated WAVs enter playback. Usable clips outside level/transient guidance are retained with warnings. Numeric checks cannot establish perceived comfort, exact source isolation or acoustic compliance with a negative prompt.

## Startup and browser verification

The native-HLS startup repair prevents a paused listener from consuming the stopped preparation run before Play establishes live audio. Ongoing layers enter together with initial fades; later boundaries remain independent. Passive playlist/status reads do not keep listeners active.

The Firefox-family freeze was reproduced in Zen 1.21.4b with HLS.js 1.7.3 using a fixture, independently of model output. The stack located the busy loop in timestamp normalization after early manifest loading. The client now defers initial source/transport loading until the server acknowledges Play and invalidates pending starts on pause, disposal or newer intent.

Fresh-session first Play, interactive controls and pause/resume passed the Zen browser retest. Unit coverage includes failed Play, pending pause/disposal and rapid intent changes. These browser checks were transport/UI evidence, not audible fidelity acceptance. No additional reporting-machine replay is a mandatory gate absent a fresh failure.

## Library and deletion verification

Saved recipes persist independently of sessions. Browsing/details are passive, and selecting a recipe only prefills the form. Search/pagination, mode restoration, Stop survival and persistence through reload were verified in desktop/mobile-sized browser views. The optional features do not each require a separate physical-device acceptance cycle.

The original deletion implementation deferred orphan cleanup behind any open session, leaving old WAVs cache-eligible. `d7ae271` separates file retention from reuse eligibility, closes matching-prompt sessions, clears saved variants and persists exclusions in SQLite v5. Shared/imported recordings are retained; unreferenced generated recordings are removed and interrupted cleanup retries.

Regression checks prove that deleting then preparing the identical prompt generates ten fresh layered WAVs across restart, even with an unrelated idle session and a shared old WAV retained. Simple mode generates four fresh beds. Only the new pool is reused on a subsequent preparation. Tests also cover cancellation/serialization, migration, held recordings, cleanup retry, shared-file paths and unrelated playback/watchdog behavior. These checks use synthetic generation adapters through the production cache/lifecycle paths and real FFmpeg.

Older databases do not distinguish all inferred sharing links from genuine reuse whose session history is gone. Those existing references are preserved conservatively; retained old recordings are still excluded from reuse by a deleted prompt. This is a documented storage limitation, not a remaining cache-correctness test.

## Setup and supported deployment

A fresh temporary source copy without environment/data/models/dependencies installed locked application dependencies and passed the project checks. A fresh Python runtime validated the sound-worker dependencies and generated offline from already installed model weights. The compiled app initialized SQLite, served its shell/API, decoded HLS and resumed the same session after normal shutdown. A new Hugging Face account, access approval and complete model download on a new machine were not repeated.

The documented dependency lock targets Apple Silicon macOS. Other backends exist, but this is not a claim of tested installation on every platform. Use the shell-selected Node.js 24 LTS runtime and documented local model setup. Models run locally after installation; runtime workers must not receive setup tokens.

The app is unauthenticated and intended for a trusted LAN, not public exposure. A reachable certified LAN IP or hostname is sufficient. Certificates do not provide name resolution. Local TLS/name rejection and recorder trust were tested; the user subsequently confirmed HTTPS access on two other devices and explicitly closed R4. The earlier device-specific warning/hang has no established cause; further investigation is issue-driven. See [README.md](README.md#installable-app-and-trusted-lan-https).

Known limitations include approximate hardware-dependent preparation times, occasional model timeouts, imperfect source isolation/negative-prompt compliance, unsupported guarantees for intelligible speech/lyrics and musical continuity, buffered stream-level changes, manual resume after a network interruption, and an offline app shell without offline audio.

## Repeatable checks

Use checks relevant to a change; this list is not a demand to rerun all completed acceptance work.

| Command | Scope |
| --- | --- |
| `pnpm check` | Lint, types, Vitest and production builds. |
| `pnpm audio:smoke` | Real AAC/HLS encoding and decoding. |
| `pnpm audio:integration` | HTTP streaming, pause/watchdog, stale requests, reconnect and Stop. |
| `pnpm audio:mixer` / `pnpm audio:phase2` | PCM continuity, future mixing, ambience buffers/retention and restart. |
| `pnpm audio:level` | File and streamed-PCM encoder level adjustment/limiting. |
| `pnpm audio:phase3` | Event scheduling, null/failure behavior and persistence with a controlled planner. |
| `pnpm audio:phase4` | Generation, validation, failure/cancellation and fresh simple audio after deletion with a controlled worker. |
| `pnpm audio:layers` | Independent layers, expansion/restart/failures and identical-prompt regeneration with controlled models. |
| `pnpm planner:smoke` | Configured real local planner; targeted `--policies`, `--crowds`, `--scenes` and `--layers` checks are available. |
| `pnpm sound:smoke --scene` | Real local sound generation and scene asset reuse. |
| `pnpm audio:layers --real` | Real layer planning/generation/HLS; `--beach` checks the beach-source regression. |
| `pnpm acceptance:run` | Short real-model scene/event/stream integration with accelerated opportunities. |
| `pnpm lan:smoke` | Local HTTPS and recorder certificate-trust behavior. |

[README.md](README.md#record-an-unattended-playback-run) describes diagnostics for a new deployment or a concrete regression. Existing laptop, physical preflight, speaker endurance and Bluetooth acceptance remain valid; the current reconciliation requires no new recording.
