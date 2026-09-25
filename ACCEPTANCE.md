# v0.1 verification record

Phase 6 separates automated behavior, real local inference, and physical listening. Passing the first two does not complete v0.1. The measured eight-hour laptop soak passed on 2026-09-24, followed by eight-hour locked-iPhone speaker endurance on 2026-09-25. The physical-device endurance gate is satisfied; remaining listening checks are in [PLAN.md](PLAN.md). Existing Bluetooth playback/control checks passed, and further Bluetooth testing is optional and issue-driven. Advanced layering is an optional prototype with separate fidelity acceptance.

## Repeatable checks

Run from the repository root with the shell-selected Node 24 and installed FFmpeg/ffprobe:

| Command | What it establishes |
| --- | --- |
| `pnpm check` | Strict schemas/types, unit and HTTP contract tests, lint, production builds. Tests include malformed/oversized requests, traversal/unknown listeners, bounded subprocess output/deadlines, literal subprocess arguments, and retry after database startup failure. |
| `pnpm audio:smoke` | Real stereo 44.1 kHz AAC, atomic HLS publication, sliding retention and decoding. |
| `pnpm audio:integration` | Actual HTTP consumption, explicit pause versus stale requests, resume, watchdog expiry, reconnect and terminal Stop cleanup. |
| `pnpm audio:mixer` | Numeric continuity across crossfades/chunk boundaries, immutable earlier audio, future event insertion, optional-file failure fallback and fractional resume positions. |
| `pnpm audio:phase2` | Sustained fixture ambience, buffer/retention bounds and restart recovery. `AUDIO_TEST_SECONDS` can extend it; a short pass is not a multi-hour result. |
| `pnpm audio:phase3` | Scripted event/null/failure decisions through real FFmpeg/HLS, sparse scheduling and persisted clock/history. |
| `pnpm audio:phase4` | Scripted sound generation through real validation/mixing: four beds, failed/invalid outputs excluded, one generated event, reuse, restart and cancellation. |
| `pnpm audio:layers` | Scripted layers through real HLS: independent starts/fades, exact chunk continuity, bounded background pools, cache reuse, required/optional failures, pause/watchdog cancellation and SQLite restoration. |
| `pnpm audio:layers --real` | Actual Qwen-derived layer policies and Medium-generated isolated-source recordings through the same short HLS/restart check. Perceptual source isolation and musical coherence remain listening gates. |
| `pnpm audio:layers --real --beach` | Exact reported beach-restaurant prompt, with explicit source-coverage/continuity/caption assertions and the same real generation, HLS and restart checks. |
| `pnpm audio:level` | Both file and streamed PCM inputs: same-encoder level changes, mute, limiting and unchanged previously published segments. |
| `pnpm lan:smoke` | Isolated HTTPS with verified trust/name, negative certificate checks, and the actual recorder CLI observing watchdog expiry without renewing demand. Temporary certificates never enter system trust. |
| `pnpm planner:smoke` | Actual local Qwen scene constraints, null/library/generated proposals and model-allocation sampling. Requires the separate Ollama service. |
| `pnpm planner:smoke --layers` | Focused real Qwen caption/policy regression for café, rain, live band and beach scenes, including caption isolation, continuity and foreground/background ordering. |
| `pnpm sound:smoke` | Actual offline Python/MLX worker and requested audio duration. Raw WAV remains quarantined; generation alone is not level or listening approval. |
| `pnpm acceptance:run` | Actual Central Park scene → four validated generated beds → four-minute HLS decode, measurements, pause, stream loss, restart and repeated-scene cache reuse. |

Phase 6 verification passes 97 tests plus lint, strict types and production builds. The transport, integration, mixer, both level inputs, Phase 3/4, HTTPS, planner and worker checks above were run successfully. Phase 3's controlled run recorded 42 nulls and one injected planner failure; Phase 4 excluded failed/invalid generated audio while continuing ambience. Both maintained at least 89.8 seconds of buffer.

The automated suite also covers bounded eight-hour **simulated** scheduling, per-listener demand, model JSON and worker-protocol bounds, cancellation/deadlines, asset compatibility/repetition, invalid generated paths, static-shell-only PWA caching, and preparation estimates. Models cannot directly execute subprocess commands or choose server paths. Input/argument checks are not a formal security audit: this unauthenticated application is for a trusted LAN, with no public port forwarding, reverse-proxy publication or WAN deployment. Ollama is restricted to a loopback HTTP origin; sound inference runs offline without setup tokens.

## Real Central Park run — 2026-09-23

Local evidence: `data/acceptance/2026-09-23T22-52-17.134Z-DUZ1MC/report.json` and its `samples.jsonl`. The source revision recorded is `25f3d98` with candidate Phase 6 changes present (`sourceDirty: true`). This is a development CLI hosting the application, not a deployed production-build or iPhone result.

Prompt: “Central Park, New York City, October 1932, around 1 AM. Cool autumn night. Quiet and appropriate for sleeping.” Explicit Sleep mode enabled. Qwen3 8B and Stable Audio 3 Medium MLX used existing local weights. FFmpeg/ffprobe 9.0.2; Node 24.12.0. No model download occurred.

| Measurement | Observed result |
| --- | --- |
| First scene ready | 128.3 seconds, including 20.1 seconds of scene planning and four 90-second beds at about 26.1–26.3 seconds each |
| Same prompt repeated | 22.1 seconds, including scene parsing; all four existing beds reused, zero new bed-generation calls |
| HTTP HLS decode | 240 seconds decoded successfully; three crossfade starts crossed |
| Playback sampling | 46 complete samples, about 5 seconds apart, no recorder issues |
| Buffer ahead | 90.0–119.7 seconds, within 45–180-second limits |
| PCM / scheduled beds | 2–3 PCM chunks and 2–5 retained bed entries during the short run |
| Session files | At most 17.5 MiB; excludes reusable assets, database and recording files |
| Server RSS / CPU | 105.9–144.6 MiB RSS; interval CPU average 0.62%, maximum 1.59% |
| Sound worker | Sampled playback RSS up to 3.05 GiB; lifetime worker-reported peak RSS 3.55 GiB. Worker log reports peak Metal allocation 4.66 GiB for beds, 3.66 GiB for events. These are different measurements, not additive total host memory. |
| Generated levels | Beds −36.8 to −36.0 dBFS mean, −18.1 dBFS peak; events −40.6 to −40.2 dBFS mean, −25.1 dBFS peak |
| Decoded stream levels | −25.0 dBFS mean, −11.2 dBFS sample peak after stream gain/limiting and AAC; no reported NaNs/Infs |
| Recovery | Explicit pause freezes the clock and stops rendering/inference; polling does not revive it. Stream loss expires the listener, stops its producer and cancels pending planning. Restart preserves scene, session/listener identity and beds; resume decodes successfully. Stop removes session files. |

There were three real event generations (7.7–8.9 seconds each), plus compatible asset reuse. Leaves and footsteps were scheduled at playback 151 and 211 seconds, inside the decoded interval; a third event at 331 seconds remained future work when this short run ended. One generated result missed its mutable slot, was discarded from that opportunity, and was subsequently reused. Repetition/context rejection and intentional software skips occurred. The real Central Park planner returned no null proposals in this sample; null behavior is separately checked by `planner:smoke` and the scripted Phase 3 regression. Pause and watchdog deliberately aborted in-flight proposals; these cancellation records are expected.

Event opportunities were accelerated **20×**, with a **30-second watchdog**. The measured inference frequency is not the production frequency. External Ollama RSS/GPU allocation is outside this process-tree sampler; short processes can fall between samples. Some separate build/fixture checks ran on the host during playback, so these are observed local measurements rather than an isolated performance benchmark. Four minutes cannot establish long-run retention stability or perceptual scene quality.

The separate real planner run, `data/planner-checks/1790204693639.json`, passed all eight calls: explicit/default dates, exclusions, requested jazz/crowds, and explicit sleep-mode overrides. Empty-library null took 8.5 seconds; the library-only response also chose null, which is valid. Generation-enabled planning proposed distant gravel footsteps in 9.1 seconds. Peak sampled Ollama-reported model/VRAM allocation was 6.17 GiB; this is not total process/host memory or an overnight trend.

## Setup and unattended handoff

A fresh temporary source copy (no `.env`, data, models or `node_modules`) installed with `pnpm install --frozen-lockfile` and passed `pnpm check`. The offline-only attempt correctly reported a missing cached tarball; the normal locked installation succeeded. A fresh Python 3.12 virtual environment installed the exact `workers/sound/requirements.txt` packages from the local uv cache and passed dependency validation. Model weights are reused from their installed manifest; this does not establish a new Hugging Face account/access flow or a full weight download on a new machine.

The fresh compiled production app served its static shell/API, initialized SQLite, decoded real fixture HLS, then shut down and restored the same session/listener for another successful decode. The fresh Python runtime generated a 12-second Medium clip offline in 9.8 seconds; its raw output was not promoted into the playback library. `fresh-runtime.json` and setup/check logs are retained beside the Central Park report. The temporary checkout, virtual environment, raw clip and test processes were removed. No browser was opened. The user's original app and Ollama listeners were preserved.

Follow [README's HTTPS recording procedure](README.md#record-an-unattended-playback-run) for the actual installed PWA. Supply the public mkcert CA through `NODE_EXTRA_CA_CERTS` and the explicit HTTPS origin; do not disable verification. Use default event cadence and the 90-second watchdog for overnight acceptance. Keep the Mac powered, awake and open, and freeze the build for the entire run.

Before declaring v0.1 complete, record the exact build, iOS/browser and sleep-bud model, actual run duration, any audible gaps or level surprises, locked-screen controls, and the final recorder summary. User-reported installed PWA, locked-screen and Bluetooth playback already work. Bonjour hostname access and Safari's certificate warning still require a physical-device follow-up. The measured eight-hour laptop soak below closes the server streaming/resource check for its layered ambience/effects scene. The later locked-iPhone speaker run satisfies physical-device endurance. Listening quality, musical continuity and comfortable adjustable level remain separate; this laptop run did not exercise long-run inference.

## Automatic layered prototype — 2026-09-23

The opt-in advanced mode uses one scene prompt. The local planner chooses the layer set, captions, relative gains and continuity policies; there is no manual track configuration. Layer clocks and random states are independent and persisted, while rendering still feeds one continuous AAC/HLS encoder. Preparation exposes per-layer counts and the existing measured estimate. Music/effects fade limits are enforced by the controller.

`pnpm check` passes 102 tests, lint, strict types and production builds. The AAC smoke, lifecycle integration, Phase 2 mixer, mixer continuity, both level inputs, Phase 3 and Phase 4 checks also pass. `audio:layers` decodes 165 seconds with at least 89.9 seconds buffered, compares independently chunked output within one signed-16-bit PCM unit, restores the exact SQLite layer state, reuses initial pools and grows to 16 assets. Additional cases cover missing optional WAVs, optional-generation failure, required-music failure, initialization cancellation and background cancellation by both explicit pause and accelerated watchdog expiry. Eight hours of scheduler simulation stay below 40 retained intervals per layer; this is not eight hours of audio.

Chrome testing used scripted planning/sound adapters with real FFmpeg to isolate the user flow: one prompt plus the advanced checkbox produced ten initial recordings across four layers. Native HLS advanced past 252.9 seconds, pause returned idle, resume continued, and Stop removed the player and layer summary. All pools grew to their bounds, and the 390×844 layout was inspected. No captured browser warnings/errors occurred. The temporary tab and server were closed. This is desktop browser evidence, not iPhone or listening acceptance.

Real layered evidence is in `data/layer-checks/layers-GLRVvt/report.json`. Qwen split the café prompt into required espresso/room ambience, required jazz piano, required conversation and optional cup effects. Stable Audio 3 Medium MLX generated all ten initial recordings and six background variations, using isolated prompts and the shared room context. The 165-second HLS decode and restart passed, with a minimum buffer of 89.92 seconds and maximum whole-versus-chunk difference of one PCM unit.

| Layered measurement | Observed result |
| --- | --- |
| Cold scene preparation | 360.0 seconds including scene/layer planning and ten initial recordings |
| Individual sound inference | Ambience 30.7–40.7 s; music 39.4–46.0 s; activity 26.5–29.7 s; effects 5.5–7.8 s, across initial and background assets |
| Full pool disk usage | 16 validated WAVs totaling 169.1 MiB; excludes model weights, database and check artifacts |
| Decoded stream levels | −32.5 dBFS mean, −13.9 dBFS sample peak at default scene level |
| Server / worker sampled RSS | Server up to 78.4 MiB; sound worker up to 3.53 GiB |
| Worker-reported Metal peak | Up to 4.94 GiB for the 120-second music clips; a different measurement from RSS, not additive host usage |
| Playback retention | At most 3 PCM chunks, 24 HLS files, 17.5 MiB of session files and 4/2/4/3 scheduled ambience/music/activity/effects intervals in the sampled window |

Resource evidence is under `data/layer-checks/layers-GLRVvt/soaks/2026-09-23T23-43-22.916Z-3cBxO0/`. It collected 29 complete samples: 14 during initialization and 15 during active playback. Its exit code 2 is expected for this deliberately wider observation window: initialization is flagged as not active, and the final sample could not connect after the test server shut down. No active-playback buffer/stall/retention issues were flagged. This is a short cost observation, not a passing soak; it misses early preparation, brief subprocesses and external Ollama allocation. Other local checks shared the host, so timings are approximate observations rather than a controlled benchmark.

Layering currently has conservative aggregate gain and can be quieter than a simple scene; listen on the actual device and use its immediate volume control or the shared Scene level setting. Source isolation, recognizable content, musical phrase/key/tempo transitions, repetition, comfortable levels and multi-hour playback remain unverified by human listening. These gates remain open in PLAN.md; the feature is a prototype and does not complete v0.1.

Repeating the same café prompt with the real Qwen planner reused all ten initial layer recordings in 52.2 seconds with **zero sound-generation calls**, then stopped cleanly (`data/layer-checks/layers-GLRVvt/cache.json`). This cache-only probe rejects any attempt to generate audio. It used `PLANNER_TIMEOUT_SECONDS=90`; the default 45-second scene deadline had timed out once during the separate bulk planner regression. Production defaults are unchanged. A one-minute excerpt crossing the ambience/music transitions is available locally at `data/layer-checks/layers-GLRVvt/cafe-preview.m4a`, with the normal default stream gain/limiter applied.

The complete real planner suite passes with the diagnostic 90-second scene/event deadline (`data/planner-checks/1790207887069.json`): café music is continuous, rain selects ambience only, and the live-band music layer has 15–45-second gaps. The earlier 45-second run timed out on the explicit sleep-off scene parse, not during playback. Layer planning allows twice the configured timeout, capped at 120 seconds.

Planner semantics still need fidelity review: the live-band ambience caption included audience murmur/glass sounds that also appeared in activity/effects. Generation adds explicit exclusions for the other selected roles, but conflicting captions and actual model source leakage can still occur. The café plan used distinct source captions; this does not establish reliable isolation for every prompt. Treat source duplication as an open advanced-mode listening/prompt-fidelity item, alongside musical continuity.

The separate `pnpm sound:smoke --scene` regression also passed four real 90-second beds, a generated 12-second event, normalization/progress reporting and exact-scene reuse (`data/sound-checks/1790207891786/scene.json`). All owned test servers and sound workers exited. The existing Ollama service remains on 11434. This task did not stop or restart the pre-existing app; at final cleanup its former PID 79631 and port 3443 listener were no longer present, so start the usual app server before testing.

## Beach source regression — 2026-09-23

The user reported that session `b5c10b35-eed8-4809-b05e-a41d831a3989` sounded mostly like a restaurant after two minutes, despite requesting crashing waves, diners, distant seagulls and Caribbean music. Its persisted plan assigned waves to optional ten-second effects at 41.67 and 199.83 seconds; there was no surf scheduled at two minutes. Music was scheduled from 13.81 seconds, so delayed entry does not explain its reported absence. Saved generation captions repeated the restaurant, visual sunshine and gulls through individual captions and shared context. These are planning/prompt defects; they do not isolate every cause of the perceived result. The original session and assets were preserved.

Layer planning now inventories audible sources from the single prompt. Software derives continuity/gap/fade policies and relative prominence, supplies very quiet room tone when no environmental source exists, and constrains shared acoustic context to reflections. Requested music/human layers are required; effects remain optional. Positive individual captions retain their source names. Music gets a musical recording caption, with background placement applied by the mixer. Generic cross-layer exclusions and the full scene label are no longer appended. Older saved policies remain readable; new captions use different asset-cache keys. Start a new layered session to use the revised planning.

The user confirmed that surf was now recognizable, but too loud/close: like sitting in the ocean rather than beside it. The first corrected plan had surf primary and diners background, contradicting the original "under the sounds of the patrons" relation. Planning now explicitly interprets this relation from the listener's position. `data/layer-checks/layers-Yaiipq/beach-balanced-preview.m4a` compares the same stems and schedule with surf about 3.1 dB lower and diners about 3.1 dB higher; its `balance-comparison.json` records the changes without modifying the user session. This level comparison does not establish acoustic distance or listening acceptance.

Final-code `PLANNER_TIMEOUT_SECONDS=90 pnpm audio:layers --real --beach` passed with local Qwen3 8B and Stable Audio 3 Medium MLX (`data/layer-checks/layers-ZwFU3I/report.json`). It assigned continuous surf/music/diners and sparse gulls, with respective gains 0.7/0.7/1.0/0.45 before aggregate normalization. Ten initial recordings were ready in 272.4 seconds, and the pool expanded to 16. The 165-second HLS decode maintained at least 89.875 seconds buffered, measured −31.8 dBFS mean/−13.4 dBFS peak, and matched whole/chunked PCM exactly. Restart restored the saved world with a 651 ms server resume and no regeneration. Shared-host timings are not controlled benchmarks. `beach-preview.m4a` in that directory is a 60-second mix of playback seconds 90–150 at the normal output gain/limiter; it has not received a listening pass.

Focused real planner checks passed in 63.1 seconds (`data/planner-checks/1790212930314-layers.json`): espresso, separate conversation/cup effects, rain-only selection, gapped live-band music and beach source assignment/relative levels. **Caption fidelity remains open:** the beach caption added unrequested thunder and interpreted Caribbean music as a jazz ensemble. Assertions verify selected source/category/continuity/balance properties, not complete semantic fidelity or acoustic isolation. Listener distance, corrected balance, musical fidelity and source duplication remain tracked in PLAN.md.

`pnpm check` passes 106 tests, lint, strict types and builds. Required AAC/lifecycle, mixer/Phase 2, both encoder-level inputs, Phase 3, Phase 4 and scripted layered checks pass. The real worker regression passes four validated 90-second beds, one event and exact-scene cache reuse (`data/sound-checks/1790211456175/scene.json`). Owned test servers and workers exited; existing app listeners on 3000/5173 and Ollama on 11434 remain. No physical-device or overnight acceptance was performed for this change.

## Open session management — 2026-09-23

The page now lists non-stopped server sessions even without a current player. It includes preparing, playing, idle and failed sessions, creation time, listener count and the four-session limit. `GET /api/sessions` is a bounded, uncached summary without listener IDs or stream URLs. It does not change activity. Individual Close and Close all use the existing Stop endpoint; bulk closure operates on the displayed IDs, retains failed closures for retry and clears the current page's URL/storage connection when it closes.

`pnpm check` passes 107 tests, lint, strict types and production builds. The new HTTP regression covers orphaned/failed session visibility, no listener credential exposure, watchdog expiry despite list polling, freeing capacity at the limit and closing every listed session. `pnpm audio:smoke` and `pnpm audio:integration` pass with real FFmpeg. The integration check required loopback binding outside the sandbox after its first attempt returned EPERM.

An isolated server with disposable sessions verified the four-session error, individual closure of a failed session, rejoining a listed stream, live playback in Chrome, Close all during playback, the empty state, creating a replacement scene, closing the current scene and reloading without restoring its old connection. The default desktop layout was visually inspected. The embedded browser crashed when attempting playback; Chrome completed the playback/closure flow. No physical iPhone or overnight checks were performed, and actual user sessions were not closed. The existing development server exposes the new list route.

## Combined layer-caption budget — 2026-09-23

The crypt scene failed before sound inference because its compiled ambience caption exceeded the application's 500-character layer limit. The inventory already permitted four sources, each with a 60-character name and 240-character caption; joining them can require 1,211 characters. The shared compiled/persisted layer limit is now 1,250, while individual bounds remain unchanged. No source is truncated or removed to fit. This application character limit is distinct from the MLX encoder's configured 256-token context; widening validation alone does not establish perceptual fidelity or guarantee every possible long caption fits that token budget.

The exact failed scene was read from its persisted metadata without modifying it. The old compiled schema reproduced the error; with the rebuilt contract, real local Qwen planning passed in 40.5 seconds, producing 523-character ambience and 458-character effects captions (`data/caption-checks/crypt-plan.json`). This was a planner check, not a new sound-generation/listening pass. Planner prompts, worker code and sampling settings are unchanged. Layer-plan failures now point to planning/server logs rather than telling the user to reinstall the sound model. Automated tests preserve four maximum-sized sources through compiled policy, JSON persistence and sound-request validation, retain oversized-input rejection, and verify the corrected error classification.

`pnpm check` passes 109 tests, lint, types and builds. Real FFmpeg `audio:smoke`, `audio:integration`, `audio:phase3` and `audio:layers` pass, including pause/watchdog behavior, saved-state restoration, layer cancellation and required/optional failures. The layered check retained at least 89.9 seconds buffered. Test processes exited normally. No physical-device or new listening acceptance is claimed.


## Overnight listening acceptance — 2026-09-24

The user reports that overnight playback worked fine and the session paused when the Bluetooth sleep buds entered their own sleep/idle mode. This listening/use check is accepted. The reported playback timestamps, `1790223949153` through `1790227734726` (Unix milliseconds), span **1 h 3 min 5.573 s**. The automatic pause is expected device behavior, not a reported stream failure.

No soak recorder was running. Starting a separate script and obtaining a session ID from the PWA was impractical with the laptop across the house. Add recording controls to the PWA, automatically attached to its current session, before asking for another unattended measured run. Diagnostic collection must remain passive and must not keep playback active.

This report does not establish eight hours of active playback or measured memory, disk, CPU/GPU, buffer and segment-retention trends. Those formal gates remain open separately from the accepted listening check. The earlier eight-minute interrupted recorder artifact is not evidence for this run. Exact build, scene/session ID, iOS version and sleep-bud model were not supplied for this report; no new automated or physical-device tests were performed while recording it.

## Eight-hour laptop soak — 2026-09-24

**Passed measured laptop streaming/resource acceptance.** The recorder completed eight hours from `2026-09-24T13:09:36.199Z` through `2026-09-24T21:09:36.200Z`, with **961/961 complete samples, all active, and zero recorded issues**. Reviewed `manifest.json`, `summary.json`, `summary.md`, `events.jsonl` and all 961 samples across both retained sample logs under `data/soaks/2026-09-24T13-09-36.252Z-OoMpeP/`.

The laptop browser consumed session `aedb1c33-5dac-4af0-a216-e1812635041d` over `http://127.0.0.1:3000`. Its layered crypt scene had four generated ambience recordings and six effect recordings. The recorder checkout was clean at `9e09593c8669edfc1cdaf3da09a93e16cfb0bb94`; Node was 24.12.0, FFmpeg 9.0.2, macOS kernel 25.3.0, arm64. The built entry modification time was `2026-09-24T03:37:22.360Z`; the recorded source revision does not certify which source built the running server. Browser/version was not recorded.

| Observation | Recorded result |
| --- | --- |
| Continuity | One server instance/PID, producer PID and encoder run throughout; cursor advanced 28,800.029 seconds; no sampled stalls, idle transitions, restarts, request errors or truncated disk scans |
| Listener demand | One active listener throughout; maximum sampled age of its last consumption was 6.01 seconds |
| Render buffer | 106.53–108.33 seconds |
| Server memory | RSS 148.70 → 86.47 MiB, peak 154.28 MiB; hourly mean heap 25.01 → 25.45 MiB |
| Encoder memory | FFmpeg RSS 21.98–24.48 MiB |
| CPU | Server mean 0.48%, peak 0.76%; FFmpeg platform estimate mean 3.27%, peak 5.10% |
| Session storage | At most 19.07 MiB and 45 files; HLS at most 40 files / 3.93 MiB; stable after initial retention fill |
| PCM queue | Exactly three chunks/files in every sample, totaling 15.14 MiB on disk |
| Layer retention | Ambience 10–11 scheduled clips, effects 6–10; oldest retained clip starts advance by about eight hours, confirming pruning; pools remain at four/six assets |
| Sampling | 30-second cadence, maximum gap 30.004 seconds; one sample-log rotation, all 961 raw samples retained |

No planner requests, generation queue items or loaded sound worker were observed. This measures sustained reuse, independent layer scheduling, mixing, encoding and stream consumption; it does not exercise continuous model inference, the simple-mode event planner, music/activity layers, or their resource costs. The recorder excludes reusable assets/database from session-disk totals, and does not measure browser memory or external Ollama/GPU allocation. Periodic samples can miss brief peaks or interruptions; stream consumption does not prove gap-free audible output.

The user reports completion of the laptop run. At this checkpoint physical-device endurance was pending; the later locked-iPhone speaker run below satisfies it. Listening-quality checks remain separate from the earlier accepted sleep-bud use check. This review changed documentation only and did not restart or stop the user's playback/server.

## Saved-scene library and details — 2026-09-24

Prepared scenes now have a persistent description/settings library, separate from running sessions and generated files. SQLite v3 preserves older sessions and records still-retained prepared scenes on startup. Prompt, sleep setting and generation mode identify duplicate recipes. Search and twelve-entry pagination use a bounded, uncached public `GET /api/scenes`; no listener credentials, file paths or worker details are exposed. Closing a session preserves its recipe. Choosing a saved description fills the form for a new session through the existing generation path; it does not promise the same rendered world. Already-deleted historical sessions are unavailable for backfill.

The expandable Scene details panel shows the original prompt, interpreted scene, constraints/weather/clock and live layer captions, continuity, recording counts and expansion state. Existing passive session polling supplies the data; there are no manual track controls and no changes to generation prompts, selection, mixing or inference cadence.

`pnpm check` passes lint, strict types, **114 tests** and production builds. New regressions cover v1/v2/v3 persistence, deduplication, search/pagination, Stop survival, upgrade backfill without rendering/inference, input bounds and watchdog expiry despite library reads. Real FFmpeg `audio:smoke`, `audio:integration` and `audio:layers` pass, including layered expansion/restart/cancellation with a minimum 89.9-second buffer. The existing Vite bundle-size advisory remains.

An isolated Chrome preview with scripted planner/audio adapters and real FFmpeg verified search/no matches, two pages of saved scenes, restoring sleep/layered settings without starting playback, preparing from the selection, simple and layered details, live expansion through completion, disabled reuse while a session is open, and uninterrupted browser playback while searching. A new simple scene remained searchable after Stop and a page reload. Desktop and 390×844 layouts were inspected, with no captured browser warnings/errors on the corrected fixture run. The first disposable generator attempt used the wrong quarantine path and was corrected; no production worker changes were needed. The test tab was closed, viewport override reset, and owned server stopped. No new physical-iPhone, eight-hour or model-fidelity acceptance is claimed.


## Physical PWA diagnostic preflight — 2026-09-24

The user reports that the five-minute diagnostic completed successfully, including deliberate-pause checks, with no apparent problems. This passes the reported short PWA preflight. The raw recording summary, exact device/OS/output details and sample counts were not supplied or reviewed for this report; intentional pauses must remain distinct from uninterrupted-playback evidence.

A separate test device is planned for an uninterrupted eight-hour run with newly prepared audio. Normal-use sleep buds will retain their usual idle/sleep behavior. Record the endurance device's actual output: speaker playback establishes that path, while Bluetooth playback establishes the tested Bluetooth path. The subsequent locked-iPhone speaker run below satisfies the eight-hour physical-device gate. No separate Bluetooth endurance run is required.


## Eight-hour locked-iPhone speaker endurance — 2026-09-25

**Passed physical-device endurance using the iPhone speaker.** The user supplied a completed eight-hour PWA diagnostic labeled iPhone 12 / iOS 26 and confirmed speaker output, a locked screen during the run, and normal audio still playing after completion. The summary and all 961 retained raw samples were reviewed: every sample was complete and active, with no recorded issues or collection errors, one server instance and one encoder run. The scene clock advanced through the full interval. Buffer levels stayed within design bounds; server memory, PCM queues, session storage, HLS retention and independent ambience/effects schedules remained bounded. Raw artifacts remain under ignored `data/soaks/`.

The recorder checkout was clean at `8b3277c`; the manifest identifies FFmpeg 9.0.2. Checkout provenance does not certify the running server build. Device/OS/output and screen-lock facts are user-reported; the user-agent string is not treated as authoritative OS identification. Server telemetry observed one or two listeners and cannot independently attribute every consumed segment to a particular device.

This session reused its existing four ambience and six effect assets. Its inference counters were zero because they are scoped to the recorded session, not ordinary scheduled reuse of an existing pool. Time-filtered lifecycle events show **six successful audio-generation completions for another session during the recording**. The shared sound worker was briefly busy, explaining its nonzero sampled memory/CPU despite zero generation counters for the monitored session. This supplies brief concurrent-generation/stream-stability evidence; it does not establish sustained model load or ongoing event generation in the recorded scene.

The locked-iPhone run satisfies the application’s physical-device endurance requirement. Previously passed Bluetooth playback, controls and normal-use listening checks remain accepted. A separate Bluetooth endurance run is not a release requirement; any further Bluetooth investigation is optional and driven by reported issues. Periodic server samples cannot prove continuous audible output, exclude every short client stall, or establish subjective mix quality. No external Ollama/GPU or browser resource capture was available. Final listening-quality checks remain open; v0.1 is not declared complete by endurance evidence alone. This review changed documentation only and did not alter playback, generation, or running processes.

## Five-scene fidelity review — 2026-09-25

The user completed a comparative listening review. The table records their observations; modes were checked against saved scene recipes. Listening duration, device/output and exact running build were not supplied for this review. The overall result is acceptable in parts but not a fidelity pass: jazz café is the strongest scene, and the beach restaurant could be a close second if its surf balance is corrected. Simple mode needs substantial improvement. Endurance acceptance remains satisfied separately.

| Scene / mode | Listening observations |
| --- | --- |
| Forest creek / simple | Recognizable generated material, but phasing/choppiness gives a poor-recording impression. Birds are constant rather than occasional. Improved over time, still clunky. |
| Rain at a window / simple | Broadly matches the requested scene, with no obvious transition faults. Window patter could be stronger. Thunder violates an explicit exclusion, though the user did not find it objectionable in this particular result. |
| Neighborhood café / layered | Initially dominated by buzzing/hum and loud, frequent machine sounds; becomes more reasonable as other layers enter. Occasional unexplained pops and prominent artificial, unintelligible vocals. No obvious later cuts. |
| Caribbean beach restaurant / layered | Surf dominates; music arrives prominently and patrons enter later. Otherwise good after layers settle. Artificial vocals sometimes become too prominent; music is dominated by steel pan. No obvious later transition faults. |
| Jazz café / layered | Best balance and source match. Cup effects contain too many clinks per burst, rather than occasional individual clinks. No obvious later transition faults. |

Across layered scenes, the user reports an initial period of audio, a hiccup, then returning audio with layers fading in. Read-only inspection of saved captions/assets and current code establishes several concrete follow-ups:

- The neighborhood café plan classifies espresso-machine hiss/gurgle as continuous ambience and generates 90-second beds, despite the request for brief machine sounds. A grinder and bottle-opening pop are not explicit sources in its saved captions; their perceived origin remains unverified.
- The creek's parsed caption drops “occasional” from distant birds and includes birds in every continuous bed. The rain's final generation captions retain “no thunder,” locating that exclusion failure after prompt forwarding rather than in a lost UI/planner constraint.
- Continuous music and human activity initially wait 7–31 seconds; effects wait 7–52 seconds. This accounts for the delayed scene balance. Independent later clip boundaries do not require delaying all ongoing sources at startup. The separate hiccup has not been reproduced or assigned a cause.
- The beach plan assigns surf/music a gain of 0.7 and diners 1.0, only about 3.1 dB nominal separation before shared normalization and bounded variation. This preserves ordering but has not delivered the requested perceived shoreline distance/balance. Crowd captions already request indistinct murmur; prominent artificial voices require source/mix review, not merely adding that wording again.
- Cup effects use ten-second recordings with plural clink captions and 45–120-second scheduling gaps. Sparse placement does not ensure sparse content within a recording. The beach music caption also narrows the request to Caribbean jazz with steel drums, marimba and congas, which should be reviewed against the intended variety.

The saved recipes and matching asset metadata cover all five scenes; only the jazz session remains available for live-session inspection. Raw prompt/asset audit records are under ignored `data/fidelity-review/`. Individual WAVs were not independently auditioned during this review, and earlier sessions' startup behavior was not captured. The creek's phasing may originate in generated material or rendering; neither is established here. No prompts, recordings, schedules, runtime code or running processes were changed, and no new automated playback tests were run. PLAN.md records focused repair/retest work; the successful jazz scene should remain a comparison case.

## Source timing and startup repairs — 2026-09-25

The later cruise-deck report exposed the same timing error more strongly: an explicitly intermittent foghorn became continuous ambience, conversation became sparse effects, and quiet music was omitted. The saved generation captions confirmed these assignments. Temporal qualifiers now take precedence over loudness in layer planning; the real local Qwen regression returns an isolated five-second horn with 45–120-second scheduling gaps, continuous quiet music and continuous distant conversation. The neighborhood café regression separates brief espresso and cup effects from its continuous crowd.

New effect policies store up to four individual source captions, short durations and gains. Each recording contains one source; initial preparation covers every selected source and the complete effects pool remains bounded at six recordings. Source identity and relative gain survive asset/state persistence. Existing saved policies without these fields retain their previous interpretation. Simple scene parsing supplies one complete source inventory with timing and category, from which software derives both the full scene caption and the ongoing bed caption; occasional birds, objects and machine operations have event categories. Event generation no longer repeats the entire scene caption. A first draft still included creek birds; a later separate bed summary dropped café conversation. These findings led to the shared source inventory and explicit bird-separation/crowd-coverage regressions. Prompt profile changes separate new recordings from old cache entries. Fresh sessions are required to apply new plans; existing recordings and schedules are not rewritten.

Ongoing layers now enter together with a shared short initial fade, while later boundaries and crossfade lengths remain independent. A regression reproduces the HLS request-ordering problem: a playlist can arrive before the explicit Play command, when only a stopped preparation run exists. Paused listeners now receive an empty live playlist and poll until Play publishes live audio, instead of playing the old run and switching midway. Reads remain passive, explicit pause remains idle and expired listeners retain their existing reconnect behavior. Live-playlist reload behavior follows [RFC 8216 §6.3.4](https://www.rfc-editor.org/rfc/rfc8216#section-6.3.4).

Background environmental gain changes from 0.7 to 0.4, and distant environmental gain from 0.45 to 0.2; music/activity gains and output peak protection are unchanged. The beach's nominal surf-to-diner separation is now about 8 dB instead of 3 dB. A comparison under ignored `data/fidelity-review/` uses the same existing recordings and deterministic schedule for both mixes. Crowd captions request blended voices rather than a featured speaker, and music instructions preserve the requested genre; real beach planning no longer adds jazz. These are candidate fidelity improvements, not listening acceptance.

`pnpm check` passes lint, strict types, **126 tests** and production builds. Real FFmpeg AAC, lifecycle, mixer, Phase 2/3/4 and both file/streamed-PCM level checks pass. Scripted layered checks pass on the final shared initial-fade implementation, including bounded pools, pause/restart, cancellation and chunk-independent mixing. Desktop Chrome playback advanced through first play and resume with no captured warnings/errors; the owned tab and fixture server were closed. The existing Vite bundle-size advisory remains.

Real Stable Audio Medium/MLX generated four creek beds, passed normalization and exact-scene cache reuse. A real Qwen/Stable Audio layered café prepared separate ambience, jazz, crowd, three-second espresso and two-second cup recordings; HLS decoding, generation during playback, pool expansion, pause/resume and restart passed with at least 89.8 seconds of buffered audio and no more than one PCM-unit chunk difference. That real run began before the final shared initial-fade adjustment; the final fade is covered by the later scripted/FFmpeg run and unit regression. Retained level advisories remain separate from malformed-audio failures.

The real Qwen parser/event/layer regression passed with a diagnostic 90-second scene/event deadline, including continuous machinery, intermittent espresso, creek birds, beach balance/genre and the cruise horn. After the final unified source inventory and category definitions, `pnpm planner:smoke --scenes` also passed: creek birds are excluded from the bed and allowed as bird events, ongoing café music/conversation are retained, and window-rain captions preserve patter/glass detail while forwarding the thunder exclusion separately. Production timeouts are unchanged. An attempted planner rerun alongside independent MLX generation timed out; the final caption verification passed without competing model work.

Existing creek WAVs have variable stereo correlation, including some negative windows. At the examined MLX decoder joins, sample jumps are not exceptional relative to surrounding samples. This numerical inspection does not explain the reported phasing or establish a perceptual repair; the DSP/codec is unchanged. Thunder exclusion, artificial vocal quality, effect density, shoreline perspective and the reported startup hiccup still require focused listening to fresh output. No new physical-device or endurance pass is claimed or required by this review; previously accepted endurance remains accepted.
