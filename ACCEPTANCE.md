# v0.1 verification record

Phase 6 separates automated behavior, real local inference, and physical listening. Passing the first two does not complete v0.1. The remaining device, listening and multi-hour gates are in [PLAN.md](PLAN.md); advanced layering is an optional prototype with its own listening and multi-hour gates.

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

Before declaring v0.1 complete, record the exact build, iOS/browser and sleep-bud model, actual run duration, any audible gaps or level surprises, locked-screen controls, and the final recorder summary. User-reported installed PWA, locked-screen and Bluetooth playback already work. Bonjour hostname access and Safari's certificate warning still require a physical-device follow-up. Listening quality, musical continuity, comfortable adjustable level, measured multi-hour playback and the final eight-hour physical run remain open.

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
