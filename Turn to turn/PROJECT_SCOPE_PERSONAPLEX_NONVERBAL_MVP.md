# Project Scope: Nonverbal Turn-Taking Layer on Top of PersonaPlex

## 1. Project Definition

### Core hypothesis

Human-computer interaction can become meaningfully better if the machine does not wait only for explicit verbal commands, but also interprets nonverbal conversational signals in real time and participates in the turn-taking process more like a person in the room.

### What we are actually building first

We are **not** trying to solve "general nonverbal intelligence" yet.

We are building a very specific first product:

**A voice conversation demo on top of PersonaPlex where the AI can distinguish between:**

- `floor holding`: the user is still speaking, even if there is a pause
- `turn yielding`: the user is giving the floor to the AI
- `backchannel window`: the AI can acknowledge without stealing the turn
- `silent acknowledgement`: the AI understood, but should not verbally respond
- `clarification opportunity`: the AI has a relevant doubt, but must decide whether to ask now or save it for later

### Proposed first product

**Working name:** `Deep Listening Turn-Taking Demo`

**Primary scenario:** `The Boss`

The user speaks in a long-form narrative or briefing mode, and the AI behaves like an attentive collaborator:

- it does not interrupt when the user is clearly still holding the floor
- it can show lightweight listening signals
- it can choose not to speak at all when the human implicitly does not want a response
- it detects important unresolved points
- it stores those unresolved points as pending clarification questions
- it only asks when the user has actually opened a conversational window

This is the right first product because it targets the place where voice AI fails most visibly today: **confusing a thinking pause with the end of a turn**.

## 2. Product Goal

### Goal for the demo

Demonstrate that adding a lightweight multimodal layer on top of PersonaPlex makes the interaction feel:

- less interruptive
- more attentive
- more human
- better at asking the right follow-up questions at the right time

### Non-goal

This first version does **not** need to:

- understand all human gestures
- solve general emotion recognition
- support multi-party conversations
- retrain PersonaPlex end to end
- become a fully productionized platform

## 3. Why PersonaPlex Is the Right Base

From the repository and README:

- PersonaPlex is already a `real-time`, `full-duplex`, `speech-to-speech` conversational model.
- It is already positioned for `low-latency` spoken interaction.
- It already supports persona and voice conditioning through prompts.
- The server already exposes a websocket loop for streaming audio in and audio/text out.
- The client protocol already defines `control` and `metadata` message types, even though the server currently does not make meaningful use of them.

This is extremely important.

It means our wedge is **not** "replace PersonaPlex".

Our wedge is:

**Add a multimodal decision layer above PersonaPlex that decides when the system should keep listening, when it should take the floor, and when it should wait even if the base model is ready to speak.**

## 4. The Right Pareto Cut

If we try to solve all conversational phenomena, we will move too slowly.

For the first demo, we should solve only these 4 decisions:

1. `HOLD`
2. `YIELD`
3. `BACKCHANNEL_OK`
4. `NO_RESPONSE`
5. `CLARIFY_NOW` vs `CLARIFY_LATER`

That is the minimum viable intelligence needed to make the interaction feel dramatically better.

## 5. Conversational Moments the System Must Detect

### A. Floor holding

Meaning:

The user pauses, but still owns the turn.

Typical examples:

- short silence while thinking
- filler like `eh`, `mmm`, `a ver`
- gaze away or upward while continuing a thought
- hand gesture still in progress
- inhalation that suggests continuation
- posture and rhythm that imply "I'm not done"

### B. Turn yielding

Meaning:

The user is actually giving the floor to the AI.

Typical examples:

- syntactic completion
- semantic completion
- gaze toward the AI/screen/camera
- gesture completion
- pause long enough to invite response
- explicit invitation: `what do you think?`, `does that make sense?`, `ok`

### C. Backchannel window

Meaning:

The AI can briefly acknowledge without taking over.

Examples:

- `mm-hmm`
- `got it`
- `claro`
- a visual or sonic acknowledgment in a future richer version

### D. Silent acknowledgement / no-response

Meaning:

The AI has understood the user, but the socially correct behavior is to stay silent.

This is different from floor holding.

In `floor holding`, the user is still actively speaking.

In `no-response`, the user may have completed a micro-utterance, but is implicitly signaling:

- `I was just saying this out loud`
- `I am thinking`
- `I am refocusing`
- `do not react`

Typical examples:

- the user says a side comment and immediately reorients attention elsewhere
- the user closes the topic with low prosodic energy and no invitation
- the user avoids gaze contact with the AI after the remark
- the user resumes task focus immediately after speaking
- the user gives a minimal acceptance signal where a spoken AI response would feel intrusive

Desired system behavior:

- do not say `that's great`, `got it`, `okay`, or similar fillers unless strongly invited
- optionally register the information internally
- remain available for the next real turn

### E. Clarification opportunity

Meaning:

The AI notices a missing detail that matters for understanding or task completion.

Examples:

- missing constraint
- ambiguous reference
- missing timeline
- unclear actor/owner
- unclear goal or success criterion

The key product behavior is:

- detect the doubt early
- save it
- decide whether to ask now or later

## 6. The Core Insight: Juxtaposition, Not Single Signals

A single signal is rarely enough.

For this product, the unit of intelligence should be:

**a short temporal combination of signals**

Examples:

### Yield pattern

- completed phrase
- gaze toward listener
- gesture completion
- 300-900 ms pause

### Hold pattern

- pause
- gaze away/upward
- filler or inhalation
- ongoing hand movement

### Ask-now pattern

- clarification queue is non-empty
- user pause crosses threshold
- body/gaze orientation opens the floor
- no continuation cue appears in the next short window

### No-response pattern

- short completed comment
- no follow-up invitation
- attention shifts back to external task
- body/gaze does not open the floor to the AI
- rapid resumption of self-directed activity

This is the heart of the system.

We are not classifying isolated gestures.

We are classifying **multimodal temporal junctions**.

## 7. Recommended MVP Scope

### In scope

- 1:1 conversation only
- one primary scenario: long-form briefing / storytelling / explanation
- webcam-based nonverbal capture
- streaming audio analysis
- turn policy on top of PersonaPlex
- clarification memory
- explicit support for implicit `do not answer` moments
- controlled interruptions only when strongly justified
- logging and replay for evaluation

### Out of scope

- multi-party conversation
- speaker diarization across many humans
- generic emotion labeling
- full body understanding
- custom foundation model training
- end-to-end video-language model
- production auth, billing, org admin, dashboards

## 8. Recommended Technical Architecture

### Layer 1: PersonaPlex stays the conversation core

PersonaPlex remains responsible for:

- speech-to-speech generation
- low-latency duplex conversation
- persona and voice behavior

### Layer 2: Multimodal sensing

#### Video sensing

Run lightweight perception in the client browser.

Recommended choice:

- `MediaPipe Tasks Vision`

Use it to extract:

- head pose
- gaze proxy
- face landmarks / blendshapes
- eyebrow movement
- mouth openness
- hand landmarks
- coarse gesture continuation vs completion
- upper body orientation

Why this choice:

- fast to prototype
- runs on-device
- no raw video upload required for MVP
- easy to replace later as long as we keep a stable feature schema

#### Audio sensing

Do not build a new speech model first.

Extract lightweight streaming features from user audio:

- VAD / speech activity
- pause length
- energy
- speech rate proxy
- F0 / intonation trend if feasible
- filler detection
- inhalation proxy if feasible

Recommended starting point:

- server-side audio feature extraction from decoded PCM
- optional `Silero VAD` or `WebRTC VAD`

### Layer 3: Clarification transcript sidecar

For the clarification system, we need some user transcript or structured semantic signal.

PersonaPlex should remain the conversation engine, but for this specific feature we should add a small ASR sidecar.

Recommended MVP choice:

- `faster-whisper-small` or another lightweight streaming ASR

Purpose:

- create partial transcript of the user
- detect unresolved entities, constraints, timelines, names, goals
- feed the clarification queue

This sidecar is not the product core.

It is a pragmatic support system for the first demo.

### Layer 4: Turn Policy Engine

This is the core of our technology.

It should run per session and maintain a short temporal state.

Recommended outputs:

- `LISTEN_DEEP`
- `LISTEN_AND_BACKCHANNEL`
- `LISTEN_SILENTLY`
- `READY_TO_RESPOND`
- `ASK_CLARIFY_NOW`
- `QUEUE_CLARIFY_FOR_LATER`

### Layer 5: Output gating

The policy layer decides whether PersonaPlex output should:

- be released immediately
- be delayed briefly
- be suppressed because the user still holds the floor
- be replaced by a short acknowledgment behavior

For MVP, a small output buffer plus gating logic is enough.

We do not need a deep invasive rewrite of PersonaPlex in phase 1.

## 9. What Neural Network We Should Actually Build

Do **not** start with a large end-to-end multimodal foundation model.

The correct MVP move is:

### Small temporal classifier on top of handcrafted features

Recommended model:

- `GRU` or small `Temporal Convolutional Network`

Input:

- 1-2 seconds of multimodal features
- sampled at roughly 10-20 Hz

Feature families:

- pause duration
- VAD state
- energy delta
- speech continuation markers
- gaze direction proxy
- head movement
- eyebrow movement
- hand movement ongoing/completed
- posture forward/back
- transcript uncertainty markers
- clarification-queue state

Output classes:

- `hold`
- `yield`
- `backchannel`
- `no_response`
- `clarify_now`

Why this is the right neural network:

- very fast to train
- very fast to run
- maintainable
- explainable
- exportable to ONNX later
- easy to improve with more data

### Important constraint

The neural network should **score** the moment.

A deterministic state machine should still make the final action decision.

This gives us:

- safety
- debuggability
- product control

## 10. The Real Core IP

The long-term defensible technology is **not** MediaPipe and not Whisper.

The defensible core is:

- the multimodal feature schema
- the turn-taking state model
- the clarification memory policy
- the labeled dataset of conversational moments
- the action policy that converts ambiguity into good interaction timing

That is what we should design carefully from day 1.

## 11. Recommended Data Strategy

### Phase 1

Start with weak labels plus manual correction.

Sources:

- recorded internal sessions
- your own `The Boss` scenarios
- a few repeated scripted conversational patterns

Label only what matters:

- hold
- yield
- backchannel
- no_response
- clarify now

### Phase 2

Refine the labels from real demo sessions:

- false interruptions
- missed chances to respond
- bad clarifying questions
- good delayed clarifying questions

This is enough to train a meaningful small model quickly.

## 12. Developer Scope

### Workstream 1: PersonaPlex integration

- clone and run PersonaPlex locally
- map websocket input/output timing
- add support for incoming `metadata` messages in the server
- add support for incoming `control` messages in the server
- add output gating hooks before audio/text are sent back to the client

### Workstream 2: Client multimodal capture

- add webcam permission flow
- run landmark extraction in browser
- derive compact feature vectors
- stream only features, not raw video, over websocket metadata frames

### Workstream 3: Audio and transcript signals

- derive VAD/pause/prosody features from incoming user audio
- add lightweight streaming ASR sidecar
- build clarification candidate extraction

### Workstream 4: Turn policy engine

- implement state machine
- implement tiny temporal neural scorer
- create inference loop
- expose current turn-state for debugging

### Workstream 5: Demo UX

- show current state in UI: `listening`, `holding`, `ready`, `question pending`
- show pending clarification questions
- log session timeline for replay

## 13. MVP Definition of Done

The MVP is done when all of the following are true:

1. In a long-form narrative, the AI usually stays silent when the human is clearly still holding the floor.
2. When the user actually yields, the AI answers fast enough to feel live.
3. When the user implicitly does not want a response, the AI remains silent instead of producing filler acknowledgements.
4. The system can detect at least some high-value missing details and queue them as clarification questions.
5. The AI can wait to ask those questions until a real opening appears.
6. The interaction feels noticeably better than a standard pause-based voice assistant.

## 14. Success Metrics

Recommended initial metrics:

- `false interruption rate`
- `missed yield rate`
- `unwanted response rate`
- `median response onset after real yield`
- `clarification usefulness score`
- `user-rated listening quality`

Suggested qualitative success target:

The user should describe the system as:

- `it really listens`
- `it knows when not to interrupt`
- `it knows when not to say anything`
- `it asks smart questions at the right moment`

## 15. What We Should Not Do Yet

- do not train a giant multimodal model
- do not start with a generic emotion engine
- do not start with many gesture classes
- do not start with multi-party interaction
- do not try to replace PersonaPlex itself

## 16. Final Recommendation

The best first product is:

**A deep-listening turn-taking demo for long-form human speech, built on PersonaPlex, with a lightweight multimodal policy layer that detects hold vs yield and manages clarification timing.**

The best technical path is:

- `PersonaPlex` as base conversation engine
- `MediaPipe` for browser-side visual features
- lightweight audio/VAD features
- small ASR sidecar only for clarification memory
- tiny `GRU` or `TCN` for moment scoring
- deterministic policy layer for final turn decisions

That is the fastest path to a real, impressive demo while still building the foundation of a long-term nonverbal interaction platform.
