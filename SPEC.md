# Procedural Generative Soundscape

## Prototype Technical Specification

**Status:** Prototype / v0.1
**Primary use case:** Locally hosted, indefinitely running, AI-assisted environmental soundscapes streamed over a LAN to an iPhone or other browser-based client.

**2026-09-23 scope clarification:** Recognizable scenes take priority over noise masking. Preserve requested music, instruments, crowds and activity throughout planning and generation. New scenes default to ordinary environmental audio; use sleep mode only when explicitly requested. Later sleep-specific examples/restrictions apply to that optional mode. Existing scene assets remain unchanged; model/prompt-profile changes invalidate reuse for new generation. The four-bed crossfade architecture does not yet maintain musical key, tempo or phrase continuity across independently generated beds.


---

# 1. Overview

Build a local application that creates long-running environmental soundscapes from a natural-language scene description.

Example:

> Central Park, New York City, October 1932, around 1:00 AM. Cool autumn night. Quiet, sparse activity, distant city noise, occasional historically appropriate events. Intended for sleep.

The application should not continuously synthesize every second of audio. Instead, it should behave as a **procedural audio simulation**:

1. Generate a small collection of compatible ambient beds.
2. Crossfade among those beds indefinitely.
3. Maintain a simulated scene state and clock.
4. At irregular intervals, ask a local LLM whether a subtle event should occur.
5. Reuse an existing generated event asset when possible.
6. Generate a new sound effect locally when necessary.
7. Mix the event into upcoming audio.
8. Cache the result for future reuse.
9. Stream the resulting audio to clients over HLS.
10. Stop generating when no client is actively consuming the stream.

The system should create **recognizable environmental and diegetic audio**: the characteristic sources, activity, perspective and acoustics of the requested place. Requested music and indistinct crowd conversation are part of the scene. Sleep is an optional use case, not the default interpretation of every prompt. When explicitly requested, sleep mode favors low novelty, gentle dynamics and fewer startling sounds.

The system should be designed so that it can eventually support other modes, such as historical environments, fantasy environments, sci-fi scenes, nature soundscapes, or interactive ambient installations.

---

# 2. Primary Goals

The prototype must:

* run completely locally after model installation;
* require no cloud AI APIs;
* accept arbitrary natural-language scene descriptions;
* generate indefinitely long soundscapes;
* work reliably for multi-hour playback;
* stream over the local network to an iPhone;
* support playback while the phone is locked;
* route normally through Bluetooth audio devices;
* stop unnecessary model inference when playback stops;
* maintain enough future audio to avoid playback interruption;
* generate occasional contextually appropriate events;
* reuse generated assets where possible;
* avoid obviously repetitive event scheduling;
* keep the underlying ambience coherent;
* expose a simple browser/PWA UI.

---

# 3. Non-Goals for v0.1

Do not attempt to implement:

* true sample-by-sample generative streaming;
* multiplayer/shared synchronized environments;
* user accounts;
* cloud hosting;
* WAN access;
* spatial audio;
* Dolby Atmos;
* real-time microphone interaction;
* voice conversations with generated characters;
* fully simulated NPC populations;
* historically authoritative reconstruction;
* mobile-native applications;
* full song composition, intelligible generated dialogue/lyrics, or beat-synchronized musical transitions;
* sophisticated semantic vector search unless needed;
* persistent distributed model serving.

The system should remain deliberately small enough to run as a local appliance.

---

# 4. Recommended Technology Stack

## Frontend

* React
* TypeScript
* Vite
* Progressive Web App support
* native HTML `<audio>` element
* Media Session API where supported

## Backend

* Node.js
* TypeScript
* Fastify preferred
* SQLite
* filesystem-based audio storage

## Audio Processing

Use FFmpeg for:

* decoding;
* resampling;
* gain control;
* panning;
* fading;
* crossfading;
* mixing;
* loudness normalization where needed;
* AAC encoding;
* HLS segmentation.

Avoid implementing DSP from scratch for the prototype.

## AI

### Sound generation

Primary target:

**Stable Audio 3 Medium through the official Apple Silicon MLX runtime** on this Mac, with Small-SFX and Small-Music as selectable alternatives. Standard PyTorch Small-SFX remains supported. Models must be measured locally before selecting them; numeric validation does not establish perceptual quality.

The sound generator should be hidden behind an interface so another model can be substituted later.

Example:

```ts
interface SoundGenerator {
  generate(request: SoundGenerationRequest): Promise<GeneratedAudio>;
}
```

### Scene/event planning

Use a small local instruction-following LLM.

A roughly 3B–8B quantized model should be sufficient.

Run it through an interchangeable backend such as:

* llama.cpp;
* Ollama;
* MLX;
* another local inference runtime.

The controller should not depend on one particular model.

---

# 5. High-Level Architecture

```text
┌──────────────────────────┐
│       iPhone / PWA       │
│                          │
│ React UI                 │
│ HTML <audio>             │
│ Media Session API        │
└─────────────┬────────────┘
              │
              │ HTTP / HLS
              ▼
┌────────────────────────────────────┐
│         Soundscape Server          │
│                                    │
│  Fastify                           │
│    ├── REST API                    │
│    ├── HLS endpoint                │
│    └── session management          │
│                                    │
│  Soundscape Controller             │
│    ├── scene state                 │
│    ├── simulation clock            │
│    ├── event scheduler             │
│    ├── ambient scheduler           │
│    ├── generation queue            │
│    └── asset selector              │
│                                    │
│  AI                                │
│    ├── local LLM                   │
│    └── Small-SFX                   │
│                                    │
│  Audio Pipeline                    │
│    ├── FFmpeg mixer                │
│    ├── rolling PCM timeline        │
│    ├── AAC encoder                 │
│    └── HLS segmenter               │
│                                    │
│  Persistence                       │
│    ├── SQLite                      │
│    └── audio asset filesystem      │
└────────────────────────────────────┘
```

---

# 6. Core Architectural Principle

The system must distinguish between:

## Ambient beds

Long-duration, relatively stationary background environments.

Examples:

* wind in trees;
* distant city wash;
* insects;
* distant road traffic;
* room tone;
* rain;
* river;
* ocean.

These should make up approximately **80–95% of the audible environment**.

## Events

Shorter, noticeable but subtle occurrences.

Examples:

* horse-drawn carriage passes distantly;
* a door or gate creaks;
* distant dog bark;
* automobile passes;
* leaves scrape across pavement;
* footsteps on gravel;
* faint train whistle;
* church bell far away.

Events should be rare enough that the listener does not feel that the system is constantly trying to produce content.

---

# 7. Session Lifecycle

A soundscape session represents one running world.

Example session state:

```ts
interface SoundscapeSession {
  id: string;

  status:
    | "initializing"
    | "active"
    | "idle"
    | "stopped"
    | "error";

  scene: SceneDefinition;

  simulatedTime: string;

  startedAt: string;
  lastClientActivityAt: string;

  ambienceAssetIds: string[];
  activeAmbienceAssetId?: string;

  recentEvents: EventHistoryEntry[];

  playbackCursorMs: number;
  renderedUntilMs: number;
}
```

State meanings:

### `initializing`

The server is creating initial ambience assets.

### `active`

At least one listener is consuming the stream.

Generation and scheduling are enabled.

### `idle`

No listener is consuming the stream.

Generation stops.

Existing scene state remains in memory or persistence.

### `stopped`

Session is explicitly terminated.

No generation occurs.

### `error`

Session encountered an unrecoverable problem.

---

# 8. Scene Definition

Store a structured scene representation.

Example:

```ts
interface SceneDefinition {
  title: string;

  originalPrompt: string;

  location?: string;
  year?: number;

  season?: string;
  timeOfDay?: string;

  weather?: {
    temperature?: string;
    precipitation?: string;
    wind?: string;
  };

  activityLevel?: "very-low" | "low" | "medium" | "high";

  sleepMode: boolean;

  constraints: string[];
}
```

Example:

```json
{
  "title": "Central Park — Autumn 1932",
  "originalPrompt": "Central Park, NYC, October 1932 around 1 AM...",
  "location": "Central Park, New York City",
  "year": 1932,
  "season": "autumn",
  "timeOfDay": "night",
  "weather": {
    "temperature": "cool",
    "precipitation": "none",
    "wind": "light"
  },
  "activityLevel": "very-low",
  "sleepMode": true,
  "constraints": [
    "historically plausible",
    "no intelligible foreground speech",
    "no modern technology sounds",
    "no sudden loud sounds"
  ]
}
```

---

# 9. Initial Scene Creation

When a user creates a scene:

1. accept the original natural-language prompt;
2. send it to the local LLM;
3. generate a structured `SceneDefinition`;
4. generate four compatible ambient beds;
5. normalize them;
6. store them as reusable assets;
7. begin assembling the playback timeline;
8. expose the HLS stream;
9. transition session to `active` once playback can safely begin.

Initial ambience recommendation:

* 4 assets;
* 60–120 seconds each;
* 44.1 kHz stereo;
* relatively little foreground activity;
* same overall acoustic environment;
* meaningful but subtle variation.

Example ambience variations:

```text
A: light wind, distant city, sparse leaves
B: slightly more wind, fewer distant vehicles
C: calmer air, slightly stronger nighttime insects
D: more distant urban wash, otherwise quiet
```

---

# 10. Ambient Playback Scheduler

Ambient beds should not play in a fixed sequence.

Avoid:

```text
A → B → C → D → A → B → C → D
```

Instead use weighted randomized selection while preventing immediate repeats.

Example:

```ts
function chooseNextAmbience(
  current: Asset,
  candidates: Asset[]
): Asset;
```

Rules:

* never replay the currently active bed immediately;
* prefer assets not used recently;
* occasionally reuse older assets;
* crossfade generously;
* preserve similar loudness.

Recommended crossfade:

```text
10–20 seconds
```

Crossfade duration may itself vary slightly.

---

# 11. Rolling Audio Timeline

The server should maintain a future audio buffer rather than synthesizing on demand at the exact playback point.

Recommended target:

```text
minimum: 45 seconds ahead
target: 90 seconds ahead
maximum: 180 seconds ahead
```

Conceptually:

```text
                    PLAYHEAD
                       │
                       ▼
──── already played ───┼──────────────────────────────
                       │       rendered future
                       │
                       │ ambience
                       │ ambience
                       │ event overlay
                       │ ambience
                       │
```

Controller logic:

```ts
if (bufferAheadMs < TARGET_BUFFER_MS) {
  scheduleMoreAudio();
}
```

Playback should never depend on immediate successful AI inference.

AI-generated material must enter the timeline well before it is required.

---

# 12. Event Scheduler

Do not run the LLM continuously.

Use a software-controlled stochastic event timer.

The scheduler determines **when** an event opportunity occurs.

The LLM determines **what**, if anything, should happen.

This distinction is intentional.

The LLM must not independently determine event frequency.

---

# 13. Event Timing Distribution

The scheduler should generate irregular delays.

For sleep mode, a reasonable starting distribution:

```text
20% → 1–2 minutes
45% → 2–5 minutes
25% → 5–10 minutes
10% → 10–15 minutes
```

These values should be configurable.

The event scheduler should also occasionally intentionally skip an opportunity.

This prevents the system from behaving like:

```text
event
3 minutes
event
3 minutes
event
3 minutes
```

Variation should be obvious statistically but not perceptually patterned.

---

# 14. LLM Event Planning

When an event opportunity occurs, provide the LLM with:

* full scene definition;
* simulated date/time;
* elapsed session time;
* current weather;
* ambient state;
* recent event history;
* restrictions;
* current event library summary.

Example input:

```text
Scene:
Central Park, New York City
October 1932
1:43 AM

Environment:
Cool autumn night
Light wind
No rain
Very low human activity

Session duration:
38 minutes

Recent events:
- 8 minutes ago: distant automobile
- 17 minutes ago: leaves scraping along pavement
- 25 minutes ago: horse-drawn carriage
- 34 minutes ago: distant footsteps

Sleep-mode constraints:
- events must be subtle
- usually distant
- no sudden loud noises
- avoid intelligible speech
- avoid repeating recent events
- event may be null

Choose at most one plausible event for the next 30 seconds.
```

Required structured output:

```ts
interface EventProposal {
  event: string | null;

  category?: string;

  durationSeconds?: number;

  prominence?: number;

  suggestedTags?: string[];

  reason?: string;
}
```

Example:

```json
{
  "event": "A distant park gate briefly creaks in the wind, followed by several dry leaves scraping across pavement.",
  "category": "environmental",
  "durationSeconds": 18,
  "prominence": 0.12,
  "suggestedTags": [
    "gate",
    "wind",
    "leaves",
    "subtle",
    "night"
  ]
}
```

Null must be a valid and encouraged result:

```json
{
  "event": null,
  "reason": "The scene has had enough recent activity."
}
```

---

# 15. Event History

Persist a rolling history.

```ts
interface EventHistoryEntry {
  id: string;

  sessionId: string;

  occurredAtSimulationTime: string;

  occurredAtPlaybackMs: number;

  description: string;

  category?: string;

  assetId?: string;

  prominence: number;
}
```

The LLM should receive enough history to discourage perceptual repetition.

Keep at least:

```text
last 30–60 minutes
```

or approximately:

```text
last 20–30 events
```

---

# 16. Asset Library

Generated effects should be reusable.

Store each generated effect as an asset.

```ts
interface AudioAsset {
  id: string;

  kind:
    | "ambience"
    | "event";

  path: string;

  durationMs: number;

  sampleRate: number;
  channels: number;

  sceneAffinity?: string[];

  tags: string[];

  description: string;

  generationPrompt: string;

  createdAt: string;

  usageCount: number;

  lastUsedAt?: string;

  source:
    | "generated"
    | "imported";
}
```

Possible tags:

```text
horse
carriage
historical
urban
night
distant
subtle
wind
rain
footsteps
park
1930s
```

---

# 17. Asset Selection

Before generating a new effect:

1. translate the event proposal into search terms;
2. query the existing asset library;
3. calculate candidate suitability;
4. reuse a sufficiently good match;
5. only generate a new asset if no good match exists.

A prototype can use simple tag matching.

Later, semantic embeddings may be added.

Example score:

```ts
score =
  contextualFit * 0.40 +
  timeSinceLastUsed * 0.30 +
  rarity * 0.20 +
  randomness * 0.10;
```

Avoid selecting the same asset repeatedly.

---

# 18. Event Asset Variation

Reusing an asset must not necessarily mean playing it identically.

The mixer can apply subtle modifications:

* gain;
* stereo placement;
* pan movement;
* EQ;
* low-pass filtering;
* reverb;
* fade duration;
* partial cropping;
* playback start offset.

Example:

```text
horse-carriage-02.wav
```

Use A:

```text
gain: -29 dB
pan: left → right
low-pass: 4 kHz
```

Use B:

```text
gain: -34 dB
pan: right → center
low-pass: 2.8 kHz
slightly more reverb
```

Use C:

```text
gain: -31 dB
start offset: +4.3 seconds
pan: center → left
```

Do not alter pitch aggressively enough to create obvious artifacts.

---

# 19. Sound Generation Prompt

When generating an event, provide both:

1. the event;
2. the environmental context.

Example:

```text
Realistic environmental field recording.

Setting:
Central Park, New York City, autumn night, October 1932.

Base environment:
Quiet urban park at night, mature trees, light wind,
very distant city traffic, sparse activity.

Event:
A horse-drawn carriage passes along a road in the distance.

The carriage should remain distant and subtle.
No intelligible speech.
No music.
No modern vehicles.
No modern sirens.
No sudden loud transient.
Natural acoustics.
Designed to sit quietly beneath a sleep soundscape.
```

Do not simply request:

```text
horse carriage
```

because the resulting acoustics may not match the scene.

---

# 20. Audio Mixing

All generated content should be mixed into the rolling timeline.

Suggested internal format:

```text
44.1 kHz
stereo
floating-point PCM where convenient
```

For events:

* schedule at a specific future playback timestamp;
* apply fade in;
* apply gain;
* optionally pan;
* optionally EQ/reverb;
* mix into ambient timeline;
* apply fade out.

The ambient bed should remain dominant.

Sleep-mode events should usually be approximately:

```text
10–30 dB quieter than foreground media
```

Actual target values should be tuned perceptually rather than treated as a strict specification.

---

# 21. Loudness Safety

The system must prevent sudden generated peaks.

Every generated asset should be analyzed before playback.

Prototype requirements:

* inspect peak amplitude;
* apply gain reduction if necessary;
* prevent clipping;
* cap unexpected transient loudness.

Optional:

* integrated LUFS measurement;
* true-peak limiting;
* scene-level target loudness.

Loudness and peak-to-average targets are guidance, not rejection criteria. Preserve usable generated recordings after normalization and peak limiting, even when sparse sounds miss those targets; retain measured levels and show an advisory warning. Prefer reduced track volume over discarding a result. Malformed or non-finite audio remains invalid.

No AI-generated asset should enter the stream unprocessed.

---

# 22. HLS Streaming

Use HLS as the playback transport.

Reasons:

* native iOS support;
* reliable background media playback;
* lock-screen compatibility;
* natural buffering;
* Bluetooth routing handled by iOS;
* no requirement for low-latency realtime transport;
* easy consumption through `<audio>`.

Example stream:

```text
http://soundscape.local/api/sessions/<id>/stream.m3u8
```

Recommended initial configuration:

```text
codec: AAC
segment duration: 4–6 seconds
playlist: sliding live playlist
```

Low-latency HLS is unnecessary.

Playback latency of several seconds is acceptable.

---

# 23. Client Player

The web client should use standard audio playback.

Conceptually:

```html
<audio
  controls
  playsinline
  src="/api/sessions/SESSION_ID/stream.m3u8">
</audio>
```

For Safari, native HLS playback should be preferred.

The frontend should display:

* scene title;
* simulated location;
* simulated year;
* simulated time;
* current weather;
* playback state;
* optional latest event description;
* start;
* pause;
* resume;
* stop.

---

# 24. Media Session API

Where supported:

```ts
navigator.mediaSession.metadata = new MediaMetadata({
  title: scene.title,
  artist: scene.subtitle,
  album: "Soundscape",
});
```

Handle:

```ts
navigator.mediaSession.setActionHandler("play", ...)
navigator.mediaSession.setActionHandler("pause", ...)
navigator.mediaSession.setActionHandler("stop", ...)
```

Goal:

normal lock-screen playback controls.

The web application should feel like an ordinary streaming audio source.

---

# 25. Pause Detection

Use two independent mechanisms.

## Explicit client signal

Listen to:

```ts
audio.addEventListener("play", ...)
audio.addEventListener("pause", ...)
audio.addEventListener("ended", ...)
```

Send:

```text
POST /api/sessions/:id/play
POST /api/sessions/:id/pause
POST /api/sessions/:id/stop
```

## Stream-consumption watchdog

Do not rely exclusively on browser JavaScript.

The server should record HLS playlist and/or segment consumption.

Example:

```ts
session.lastClientActivityAt = new Date();
```

If no relevant stream request has occurred for a configured timeout:

```text
60–120 seconds
```

transition the session to `idle`.

When idle:

* stop event scheduling;
* stop new sound generation;
* stop extending the audio timeline;
* retain scene state;
* retain generated assets;
* optionally keep models loaded.

This is important because mobile Safari may suspend JavaScript.

---

# 26. Resume Behavior

When an idle session resumes:

1. receive a play request or observe new HLS consumption;
2. transition to `active`;
3. ensure sufficient buffered audio exists;
4. restart the scheduling loop;
5. continue the scene from its stored state.

For v0.1, the simulated scene clock may either:

* freeze while paused; or
* advance with real elapsed time.

Recommended default:

```text
freeze simulated time while paused
```

because it makes continuation easier to reason about.

---

# 27. Model Lifecycle

Models do not need to unload immediately on pause.

Suggested behavior:

```text
ACTIVE
models loaded

↓ no listener

IDLE < 30 min
models remain loaded

↓ idle timeout

DEEP IDLE
optionally unload AI models
retain session data
```

Make thresholds configurable.

---

# 28. Generation Queue

Never allow several expensive generation requests to pile up.

Use a serialized or low-concurrency generation queue.

Example:

```ts
interface GenerationJob {
  id: string;

  sessionId: string;

  kind:
    | "ambience"
    | "event";

  prompt: string;

  priority: number;

  deadlinePlaybackMs?: number;
}
```

Recommended concurrency:

```text
1 Small-SFX generation at a time
```

unless benchmarking shows parallel generation is beneficial.

Event jobs should have enough lead time that missing one does not threaten playback.

If generation cannot finish in time:

**drop the event.**

Never delay playback.

---

# 29. Failure Philosophy

Ambient playback is more important than event generation.

If any of these fail:

* LLM;
* Small-SFX;
* event generation;
* asset lookup;
* metadata generation;

the server should continue playing ambience.

Example:

```text
LLM timeout
→ skip event
→ ambience continues
```

```text
Small-SFX failure
→ skip event
→ ambience continues
```

```text
asset missing
→ skip asset
→ ambience continues
```

Do not allow optional generative features to interrupt sleep audio.

---

# 30. REST API

Initial API proposal.

## Create scene

```http
POST /api/sessions
```

Body:

```json
{
  "prompt": "Central Park, New York City, October 1932...",
  "sleepMode": true
}
```

Response:

```json
{
  "id": "session-id",
  "status": "initializing"
}
```

---

## Open sessions

```http
GET /api/sessions
```

Return a bounded list of all non-stopped sessions on the local server, including idle, preparing and failed sessions restored after restart, plus the session limit. Include title, status, readiness, listener count, creation time and generation mode; do not expose listener credentials. Listing must not renew activity, start playback or trigger inference.

The page must show these sessions even when it has no current player. Provide individual Close actions and Close all for the displayed sessions, using the existing Stop lifecycle. Explain that closing ends playback for all listeners. Refresh after changes, preserve sessions whose close request fails, and clear the page's connection when its own session closes. Do not automatically discard sessions to make room.

---

## Session status

```http
GET /api/sessions/:id
```

Response:

```json
{
  "id": "...",
  "status": "active",
  "scene": {},
  "simulatedTime": "01:43",
  "bufferAheadSeconds": 87,
  "recentEvents": []
}
```

---

## Stream

```http
GET /api/sessions/:id/stream.m3u8
```

---

## Play

```http
POST /api/sessions/:id/play
```

---

## Pause

```http
POST /api/sessions/:id/pause
```

---

## Stop

```http
POST /api/sessions/:id/stop
```

---

## Existing scenes

```http
GET /api/scenes?q=...&offset=0
```

Saved-scene browsing retains successfully prepared descriptions, interpreted scene metadata, and simple/layered and sleep settings independently of session lifetime. Results are searchable and paginated in groups of twelve. Selecting an entry prefills the creation form for a new session; existing sessions remain resumable through the open-session list. Browsing and the read-only scene-details panel never renew listener activity or trigger inference.

Each saved scene has a Delete action with a simple “Are you sure?” confirmation. `DELETE /api/scenes/:id` closes matching-prompt sessions and clears all saved mode variants and cached reuse for that normalized description. Cancel and settle their generation before clearing metadata. Preparing the identical description again must generate fresh recordings, even when an old WAV is retained for another prompt. Preserve WAVs referenced by different saved prompts and all imported recordings; remove orphaned generated recordings without waiting for unrelated idle sessions. Do not infer new sharing from acoustic similarity. Unrelated playback and listener activity remain unchanged. Persist scene-to-recording references, prompt-specific cache exclusions and pending cleanup through restart; retry deferred file removal automatically.

---

## Assets

```http
GET /api/assets
```

Useful for development/debugging.

---

# 31. SQLite Schema

Approximate schema.

## `sessions`

```sql
id TEXT PRIMARY KEY
status TEXT NOT NULL
title TEXT
original_prompt TEXT NOT NULL
scene_json TEXT NOT NULL
simulated_time TEXT
started_at TEXT
updated_at TEXT
last_client_activity_at TEXT
```

## `assets`

```sql
id TEXT PRIMARY KEY
kind TEXT NOT NULL
path TEXT NOT NULL
duration_ms INTEGER NOT NULL
sample_rate INTEGER
channels INTEGER
description TEXT
generation_prompt TEXT
tags_json TEXT
source TEXT
usage_count INTEGER DEFAULT 0
created_at TEXT NOT NULL
last_used_at TEXT
```

## `events`

```sql
id TEXT PRIMARY KEY
session_id TEXT NOT NULL
asset_id TEXT
description TEXT NOT NULL
category TEXT
prominence REAL
playback_position_ms INTEGER
simulation_time TEXT
created_at TEXT NOT NULL
```

---

# 32. Filesystem Layout

Example:

```text
data/
  soundscape.db

  assets/
    ambience/
      <uuid>.wav

    events/
      <uuid>.wav

  sessions/
    <session-id>/
      hls/
        stream.m3u8
        segment-000001.aac
        segment-000002.aac
        ...

      temp/
```

HLS segments may be garbage-collected after falling sufficiently far behind the playback window.

---

# 33. Background Controller

Each active session should have a loop equivalent to:

```ts
while (session.status === "active") {
  updateClientActivity();

  if (shouldIdleSession()) {
    transitionToIdle();
    break;
  }

  if (bufferAhead() < TARGET_BUFFER) {
    extendAmbientTimeline();
  }

  if (eventOpportunityDue()) {
    await schedulePotentialEvent();
  }

  await sleep(CONTROLLER_TICK_MS);
}
```

Suggested tick:

```text
500–2000 ms
```

No hard realtime requirement exists.

---

# 34. Event Scheduling Algorithm

Pseudo-code:

```ts
async function schedulePotentialEvent(session: Session) {
  const proposal = await eventPlanner.propose({
    scene: session.scene,
    simulatedTime: session.simulatedTime,
    recentEvents: session.recentEvents,
  });

  if (!proposal.event) {
    scheduleNextOpportunity();
    return;
  }

  const match = await assetLibrary.findMatch(proposal);

  let asset: AudioAsset;

  if (match && match.score >= MATCH_THRESHOLD) {
    asset = match.asset;
  } else {
    asset = await soundGenerator.generate(
      buildSoundPrompt(session.scene, proposal)
    );

    await assetLibrary.store(asset);
  }

  const presentation = createEventPresentation(
    asset,
    proposal,
    session
  );

  mixIntoFutureTimeline(presentation);

  recordEventHistory(...);

  scheduleNextOpportunity();
}
```

---

# 35. Prototype Event Rules

For sleep mode, hard-code several safety constraints regardless of LLM output.

Reject or modify events involving:

* explosions;
* screaming;
* gunfire;
* crashes;
* alarms;
* sirens at close distance;
* sudden nearby animal noises;
* loud horns;
* sharp percussive impacts;
* intelligible foreground conversations;
* dramatic weather changes.

The LLM is advisory.

The application remains responsible for enforcing scene rules.

---

# 36. Scene Evolution

The scene may evolve slowly.

Examples:

```text
wind increases slightly
rain begins
rain stops
traffic becomes quieter
birds gradually decrease
night insects increase
```

These should occur much less frequently than ordinary events.

For v0.1, implement scene evolution only if simple.

A reasonable interval:

```text
10–30 minutes
```

Potential structured result:

```ts
interface SceneMutation {
  changes: Partial<SceneDefinition>;
  transitionMinutes: number;
}
```

Do not permit abrupt changes in sleep mode.

---

# 37. Ambient Pool Evolution

Initially:

```text
[A B C D]
```

Later, optionally generate replacements:

```text
[B C D E]
```

Then:

```text
[C D E F]
```

This allows the ambience itself to evolve gradually.

This feature is optional for v0.1.

The first functional prototype may simply keep the initial four ambient assets for the entire session.

## Optional advanced layered scenes

An opt-in advanced generation mode may trade longer preparation for independently controlled layers: environmental ambience, requested music, human activity/crowd or nonverbal vocal textures, and discrete effects. These are functional mixing layers: diegetic music and sound effects can both belong to the scene. The user supplies one scene prompt and enables advanced mode; layer selection, focused prompts and scheduling policies are generated automatically, without manual track configuration. Generate only the layers the scene needs, with focused source prompts and shared acoustic context. Isolated outputs and compatible musical timing are hypotheses to validate, not guaranteed model capabilities; intelligible dialogue and lyrics remain outside this proposal.

Generate and cache assets sequentially under the existing inference budget, then mix them cheaply into the same server-side HLS stream. Each layer can have its own schedule, gain and transitions; no continuous inference or additional client players are required. Retain bounded timelines, layer counts, aggregate headroom, future-only edits and pause/watchdog behavior. Music needs coherent phrases and transitions; initially prefer one music layer over independently synthesized instruments that might disagree in tempo or key.

Plan from an inventory of the requested audible sources in the single prompt. Repeated environmental sounds such as breaking surf belong in continuous beds; distant individual bird calls belong in occasional effects. Generate each source with a concrete positive caption. Shared acoustic context must not reintroduce the place name, visual details or other sources into every recording. Describe requested music with genre, instruments and rhythm; the mixer supplies its background level. Keep each source's caption in the saved layer policy so omissions and misassignments can be inspected. Schema and model checks do not establish perceptual fidelity.

Keep individual source captions concise (240 characters, plus a name up to 60 characters), while allowing the compiled layer to contain all four sources. Its 1,250-character application limit accommodates the 1,211-character worst case without truncation. This character budget is separate from the selected sound model's tokenizer/context limit. Report layer-plan failures as planning errors rather than sound-installation failures.

Interpret relative prominence from the listener's position: a powerful source is not necessarily foreground. Sounds described as underneath other activity should be quieter than that activity. Hearing waves from a table beside the shore should not imply a close recording in the water. Treat mix level and acoustic distance/perspective as separate listening concerns; do not require manual track controls to express this intent.

Use a scene controller with independently scheduled layers on one shared session playback clock. Ongoing sources should establish the scene together at startup with suitable fades; do not require the listener to wait for continuous conversation or background music. Subsequent clip boundaries and crossfades remain independent: a song can continue unchanged across several ambience transitions, while intentionally intermittent sources can enter later. PCM render chunks and HLS segment boundaries are transport details, never musical or environmental boundaries.

Classify source timing separately from prominence. Brief espresso operations, occasional bird calls and intermittent horn blasts are discrete effects even when loud. Generate each effect source separately with the requested number of actions and natural decay; sparse scheduling must not disguise dense repeated bursts inside a recording. In simple mode, ongoing bed captions exclude these occasional sources so the event scheduler can place them separately. Preserve requested quiet music and distant conversation as ongoing sources rather than omitting or demoting them to occasional effects.

Give each discrete source its own prompt-derived frequency and persisted random clock. The initial qualitative presets use 20–45-second gaps for frequent effects, 45–120 seconds for occasional effects, and 180–420 seconds for rare effects. Gaps follow the previous occurrence of that same source; the first occurrence also waits within its range. Serialize effects with at least five seconds of quiet between different sources to preserve mix headroom; contention may lengthen a source's gap. Select variants within each source pool without immediate reuse when alternatives exist. Preserve old saved policies' original shared clock, and never backfill missed events into already scheduled audio.

Apply exclusions to the named sound rather than every member of its category: “no rain” permits a requested creek, and “no horns” permits requested espresso sounds. Check supported source exclusions in compiled inventories, reused asset descriptions and proposed events before generation. Category-wide bans remain category-wide. A constraint on prominence or intelligibility must not remove the requested source. Keep the original constraint for model conditioning; text validation does not prove acoustic compliance.

Translate the prompt into validated per-layer policies, then let a deterministic scheduler make routine choices rather than invoking the LLM for each transition. Policies can specify weighted asset pools, desired continuity/activity, gap ranges, crossfade durations, variability, repetition cooldowns and maximum overlap. For example, a cafe jazz layer may run continuously, a live band may pause between songs, ambience/crowd layers may crossfade continuously, and a larger pool of short effects may produce sparse weighted events. Do not apply ambient crossfade rules to music indiscriminately; preserve complete passages where possible and explicitly plan gaps or compatible transitions.

Derive a separate random sequence for each stable layer ID from the session seed. Persist selected assets, scheduled intervals and random state so pause/restart preserves the world and adding an effects layer does not reshuffle the music. Reproducibility applies to scheduling for a fixed policy and asset pool, not bit-identical model output across runtimes. Schedule only a bounded future horizon and prune consumed intervals; background pool expansion must stay off the playback refill path. Prepare a minimum usable pool per required layer, and allow optional pools to grow gradually within inference/idle limits instead of requiring a large effects library before first playback.

Keep the current simpler mode as the default. Before advanced preparation, communicate the longer estimated wait; during preparation, expose per-layer progress and time to playable audio. Define required versus optional layers and report degraded results when optional generation fails. Benchmark resources and conduct listening/multi-hour acceptance before presenting this mode as complete. This exploration is optional and does not block v0.1.

---

# 38. Simulation Clock

Maintain a fictional scene clock.

Example:

```text
Session begins:
1:00 AM

30 real minutes later:
1:30 AM
```

Default:

```text
1 simulated minute = 1 real minute
```

Store simulation time independently of wall-clock time.

This enables future scenes with accelerated or slower time.

---

# 39. PWA UX

Initial screen:

```text
┌─────────────────────────────┐
│ Soundscape                  │
│                             │
│ Describe a place            │
│ ┌─────────────────────────┐ │
│ │ Central Park, NYC...    │ │
│ └─────────────────────────┘ │
│                             │
│ ☑ Sleep mode                │
│                             │
│       Create Scene          │
└─────────────────────────────┘
```

Playback screen:

```text
┌─────────────────────────────┐
│ Central Park                │
│ New York City · 1932        │
│                             │
│ Autumn · 1:43 AM            │
│ Cool · light wind           │
│                             │
│        ▶ / ❚❚               │
│                             │
│ Event activity: Low         │
│                             │
│ Recent:                     │
│ Distant automobile          │
└─────────────────────────────┘
```

Keep the UI intentionally sparse.

Initial preparation should provide live, understandable progress and an approximate time until audio is playable, rather than only changing status text. Show the current stage, completed work and within-stage progress when available. Estimates should use measured model/backend timings and account for queueing, cold loading, asset reuse, generation, validation and playback buffering. Present a range and update it as evidence improves; use an indeterminate/estimating state when a credible estimate is unavailable. Do not fabricate progress or indicate completion before playback is ready.

Keep this feedback compact on mobile, survive reconnects using server state, and clearly distinguish slow work, failure, cancellation and readiness. Progress polling must not renew listener activity. This is planned Phase 5 UX polish, not a prerequisite for continuing current development.

---

# 40. Local Network Access

Bind the server to the LAN, not only `localhost`.

Example:

```text
0.0.0.0:3000
```

Ideally advertise through mDNS:

```text
soundscape.local
```

Expected user flow:

```text
http://soundscape.local
```

Do not require users to remember a private IP address.

---

# 41. Security

Prototype assumptions:

* trusted home LAN;
* no WAN exposure.

Still:

* reject arbitrary filesystem paths;
* sanitize identifiers;
* never interpolate user input directly into shell commands;
* invoke FFmpeg with argument arrays rather than shell strings;
* validate model output;
* validate JSON through schemas;
* limit uploaded/generated asset sizes;
* prevent path traversal.

Do not expose the service publicly by default.

---

# 42. Configuration

Example:

```ts
interface AppConfig {
  port: number;

  targetBufferSeconds: number;
  minimumBufferSeconds: number;

  idleTimeoutSeconds: number;
  modelUnloadTimeoutMinutes: number;

  hlsSegmentSeconds: number;

  ambienceCount: number;
  ambienceDurationSeconds: number;

  eventActivity: "very-low" | "low" | "medium";

  soundModel: {
    provider: string;
    modelPath?: string;
  };

  llm: {
    provider: string;
    model: string;
    endpoint?: string;
  };
}
```

Suggested defaults:

```text
target buffer:          90 sec
minimum buffer:         45 sec
idle timeout:           90 sec
model unload timeout:   30 min
HLS segment:            6 sec
ambience count:         4
ambience duration:      90 sec
event activity:         low
```

---

# 43. Logging

Log important lifecycle events.

Example:

```text
[session] created 2f41...
[ambience] generating 1/4
[ambience] generated asset a31...
[stream] session active
[event] opportunity fired
[event] planner returned "distant carriage"
[asset] reused event 7cc...
[mixer] event scheduled +72.4 sec
[stream] no client activity for 90 sec
[session] transitioned to idle
```

Avoid excessive logging per HLS request in normal mode.

Debug mode may include detailed stream traffic.

---

# 44. Diagnostics

Expose a development/debug route:

```http
GET /api/debug/sessions/:id
```

Return:

```json
{
  "bufferAheadSeconds": 91,
  "generationQueue": [],
  "nextEventOpportunitySeconds": 184,
  "activeAmbience": "...",
  "modelsLoaded": {
    "llm": true,
    "sound": true
  },
  "lastClientRequestAgoSeconds": 3
}
```

Useful during prototype development.

---

# 45. Testing Strategy

## Unit tests

Test:

* event delay generation;
* history filtering;
* asset scoring;
* scene state updates;
* JSON validation;
* state transitions;
* idle timeout;
* asset selection;
* mixer parameter generation.

## Integration tests

Test:

* session creation;
* generated ambience registration;
* HLS playlist creation;
* pause transition;
* resume transition;
* simulated model failure;
* FFmpeg failure;
* empty event proposal;
* asset reuse.

## Manual tests

Verify on iPhone:

1. open PWA;
2. start scene;
3. stream begins;
4. lock phone;
5. audio continues;
6. Bluetooth sleep buds continue receiving audio;
7. Control Center shows media;
8. pause from lock screen;
9. server becomes idle;
10. generation stops;
11. resume;
12. playback continues.

---

# 46. Prototype Milestones

## Milestone 1 — Static Streaming

Build:

```text
React UI
Node server
FFmpeg
HLS
```

Stream one existing WAV file indefinitely.

Acceptance:

* iPhone plays stream;
* screen can lock;
* Bluetooth works;
* pause/resume works.

---

## Milestone 2 — Procedural Ambience

Add:

* four local ambience files;
* randomized sequencing;
* long crossfades;
* rolling HLS timeline.

No AI required yet.

Acceptance:

* stream runs for several hours;
* no gaps;
* transitions are difficult to detect;
* memory/disk usage remain bounded.

---

## Milestone 3 — Session Lifecycle

Add:

* SQLite;
* session model;
* active/idle/stopped states;
* stream activity watchdog.

Acceptance:

* server stops rendering after playback stops;
* resume works;
* scene state survives normal idle periods.

---

## Milestone 4 — Local LLM Event Planner

Add:

* local LLM adapter;
* event opportunity scheduler;
* structured event proposals;
* event history.

Initially use manually supplied event WAVs.

Acceptance:

* plausible event decisions;
* null events occur;
* repeats are uncommon;
* scheduler remains responsible for timing.

---

## Milestone 5 — Small-SFX Generation

Add local sound generation.

Flow:

```text
event proposal
→ asset search
→ generate if missing
→ normalize
→ store
→ mix
```

Acceptance:

* no API calls;
* generation remains ahead of playback;
* generation failure does not interrupt stream.

---

## Milestone 6 — Asset Reuse

Add:

* tags;
* asset scoring;
* usage history;
* simple variation during playback.

Acceptance:

* previously generated events are reused;
* identical assets do not repeatedly sound identical;
* generation frequency decreases over time.

---

## Milestone 7 — Scene Evolution

Optional.

Add:

* slowly changing weather;
* ambience regeneration;
* rolling ambience replacement.

Acceptance:

* environment evolves gradually;
* no abrupt changes;
* sleep quality remains primary.

---

# 47. Critical Acceptance Criteria

The prototype is successful when all of the following work:

1. User enters:

   ```text
   Central Park, New York City, October 1932, 1 AM
   ```

2. Server constructs a scene.

3. Four compatible ambience beds are available.

4. iPhone begins HLS playback.

5. Phone may be locked.

6. Audio continues through Bluetooth sleep buds.

7. Ambience can run indefinitely.

8. Approximately every few minutes, the scheduler considers an event.

9. LLM may decide that nothing should happen.

10. Otherwise a subtle event is selected.

11. Existing asset is reused when suitable.

12. Otherwise local Small-SFX generation occurs.

13. Event is mixed into future audio.

14. Playback never waits for generation.

15. No unexpectedly loud generated content reaches the listener.

16. Events do not become predictably periodic.

17. Pausing playback causes generation to stop.

18. Loss of client stream consumption independently causes generation to stop.

19. Session may resume without recreating the entire world.

20. The application can run unattended for at least eight hours. Validate endurance on a locked physical iPhone; speaker output is sufficient. Bluetooth routing and controls are separate short interaction checks, not a second endurance requirement. Further Bluetooth testing is optional and issue-driven.

---

# 48. Design Philosophy

The core product is **not an AI audio generator**.

It is a small simulated acoustic world.

AI should handle the parts where generative reasoning is useful:

```text
What might plausibly happen?
What new sound asset is needed?
How should the scene slowly evolve?
```

Traditional software should handle:

```text
timing
playback
mixing
volume
safety
buffering
caching
history
state
resource management
```

The system should intentionally allow long stretches where nothing novel happens.

For sleep audio, a successful result should feel less like:

```text
AI continuously creating interesting sounds
```

and more like:

```text
a place continues to exist even when nothing happens
```

A distant carriage five minutes into an otherwise quiet night should feel significant precisely because the engine has not been constantly filling the soundscape with events.

---

# 49. Suggested Repository Structure

```text
soundscape/
  apps/
    web/
      src/
      public/

    server/
      src/
        api/
        audio/
        sessions/
        scheduler/
        assets/
        llm/
        soundgen/
        persistence/
        config/

  packages/
    shared/
      src/
        types/
        schemas/

  data/
    assets/
    sessions/

  scripts/

  docker/

  README.md
```

The sound-generation Python code may live separately:

```text
workers/
  soundgen/
    server.py
    model.py
```

Expose a small local API or invoke the worker through IPC.

Do not tightly couple the Node application to Python implementation details.

---

# 50. Initial Implementation Order

Codex should begin with the following order:

```text
1. scaffold monorepo
2. React PWA
3. Fastify API
4. session types/state machine
5. static HLS streaming
6. rolling FFmpeg audio pipeline
7. pause/activity watchdog
8. SQLite persistence
9. randomized ambience scheduler
10. event scheduler
11. local LLM adapter
12. structured event proposal schema
13. asset database
14. Small-SFX adapter
15. generated event normalization
16. event mixing
17. asset reuse scoring
18. Media Session integration
19. long-duration reliability testing
```

Do not begin with AI integration.

First prove that:

```text
iPhone
→ HLS
→ locked screen
→ Bluetooth
→ pause detection
→ server idle
```

works reliably.

That transport and lifecycle path is the foundation of the entire system.

---

# 51. Definition of Done for v0.1

A v0.1 prototype is complete when a developer can run something approximately equivalent to:

```bash
pnpm install
pnpm dev
```

plus any required local model setup, open:

```text
http://soundscape.local
```

from an iPhone, enter:

```text
Central Park, New York City, October 1932, around 1 AM.
Cool autumn night. Quiet and appropriate for sleeping.
```

and receive an indefinitely running locally generated soundscape in which:

* ambience remains coherent;
* events occur irregularly;
* events are contextually plausible;
* events remain subtle;
* existing effects are reused;
* new effects are generated locally as required;
* the audio remains stable while the phone is locked;
* playback routes normally to Bluetooth sleep buds;
* pausing the stream stops further generation;
* the application can run overnight without manual intervention.
