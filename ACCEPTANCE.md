# v0.1 verification record

Phase 6 separates automated behavior, real local inference, and physical listening. Passing the first two does not complete v0.1. The remaining device, listening and multi-hour gates are in [PLAN.md](PLAN.md); advanced layering is a separate optional work item.

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
| `pnpm audio:level` | Both file and streamed PCM inputs: same-encoder level changes, mute, limiting and unchanged previously published segments. |
| `pnpm lan:smoke` | Isolated HTTPS with verified trust/name, negative certificate checks, and the actual recorder CLI observing watchdog expiry without renewing demand. Temporary certificates never enter system trust. |
| `pnpm planner:smoke` | Actual local Qwen scene constraints, null/library/generated proposals and model-allocation sampling. Requires the separate Ollama service. |
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
