/**
 * DopamineEngine.js
 * Natural interaction system between Ü (vector face) and the human user.
 *
 * Powered by MediaPipe FaceLandmarker 52 Blendshapes (ARKit-compatible).
 *
 * DESIGN PRINCIPLES (based on real human interaction):
 *   - Expressions are HELD, not flickered. Humans hold a smile for 2-6 seconds.
 *   - Transitions are gradual. A face doesn't snap between states.
 *   - Winks are extremely rare in real interaction (~1% of exchanges).
 *   - The default resting state is a soft, warm neutral — not blank.
 *   - A gesture must be SUSTAINED (~500ms) before Ü reacts. Noise is ignored.
 *   - After reacting, Ü holds the expression, then slowly decays back to warm neutral.
 *   - Mirror responses dominate (~80%). Contrast is rare and subtle.
 *
 * Flow:
 *   1. Blendshapes → sustained gesture detection (debounced, not per-frame)
 *   2. Confirmed gesture → 7D semantic vector
 *   3. Cosine similarity → select response (heavily biased toward mirror)
 *   4. Emit response with long transition duration
 *   5. Hold expression → gradual decay to warm neutral
 */

class DopamineEngine {
    constructor() {
        // ─── Blendshape Thresholds (0-1, ML-calibrated) ───
        this.thresholds = {
            smile:        0.40,   // mouthSmile average — slightly higher to avoid false positives
            eyebrowRaise: 0.30,   // browInnerUp + browOuterUp average
            surprise:     0.35,   // jawOpen + eyeWide composite
            squint:       0.35,   // eyeSquint average
            headTilt:     10,     // degrees (from landmarks)
            nod:          4.0     // pitch velocity (from landmarks)
        };

        // ─── Blendshape Name Map (built on first frame) ───
        this._blendshapeMap = null;

        // ─── Gesture Vector Space (7D semantic embedding) ───
        // Dimensions: [warmth, energy, openness, playfulness, empathy, intensity, calm]
        this.userGestureVectors = {
            smile:         [ 0.9,  0.6,  0.8,  0.7,  0.8,  0.3,  0.5],
            eyebrow_raise: [ 0.4,  0.7,  0.9,  0.5,  0.3,  0.6,  0.2],
            surprise:      [ 0.5,  0.9,  0.9,  0.6,  0.4,  0.8,  0.1],
            squint:        [ 0.6,  0.3,  0.2,  0.4,  0.7,  0.5,  0.6],
            head_tilt:     [ 0.7,  0.4,  0.5,  0.8,  0.6,  0.3,  0.7],
            nod:           [ 0.8,  0.5,  0.6,  0.3,  0.9,  0.4,  0.8],
            neutral:       [ 0.3,  0.2,  0.4,  0.2,  0.3,  0.1,  0.9]
        };

        // ─── Ü Response Vectors (maps to Face PRESETS in app.js) ───
        // REMOVED wink as a standard response — it's now a rare special event
        this.responseVectors = {
            smile:          { vector: [ 0.9,  0.6,  0.8,  0.7,  0.8,  0.3,  0.5], preset: 'smile',          dopamine: 0.9  },
            mild_attention: { vector: [ 0.6,  0.5,  0.7,  0.5,  0.7,  0.4,  0.6], preset: 'mild_attention', dopamine: 0.6  },
            thinking:       { vector: [ 0.4,  0.4,  0.3,  0.3,  0.6,  0.7,  0.5], preset: 'thinking',      dopamine: 0.5  },
            listening:      { vector: [ 0.7,  0.3,  0.8,  0.2,  0.9,  0.3,  0.8], preset: 'listening',     dopamine: 0.7  },
            neutral:        { vector: [ 0.3,  0.2,  0.4,  0.2,  0.3,  0.1,  0.9], preset: 'neutral',       dopamine: 0.3  }
        };

        // ─── Dopaminergic Response Graph (realistic human interaction weights) ───
        // NO wink in standard responses. Warm, natural reactions only.
        this.dopamineGraph = {
            smile:         [{ response: 'smile', weight: 0.6 }, { response: 'mild_attention', weight: 0.3 }, { response: 'listening', weight: 0.1 }],
            eyebrow_raise: [{ response: 'mild_attention', weight: 0.5 }, { response: 'listening', weight: 0.3 }, { response: 'smile', weight: 0.2 }],
            surprise:      [{ response: 'smile', weight: 0.4 }, { response: 'mild_attention', weight: 0.4 }, { response: 'listening', weight: 0.2 }],
            squint:        [{ response: 'thinking', weight: 0.4 }, { response: 'mild_attention', weight: 0.4 }, { response: 'listening', weight: 0.2 }],
            head_tilt:     [{ response: 'mild_attention', weight: 0.5 }, { response: 'smile', weight: 0.3 }, { response: 'listening', weight: 0.2 }],
            nod:           [{ response: 'smile', weight: 0.5 }, { response: 'listening', weight: 0.3 }, { response: 'mild_attention', weight: 0.2 }],
            neutral:       [{ response: 'neutral', weight: 0.4 }, { response: 'mild_attention', weight: 0.5 }, { response: 'listening', weight: 0.1 }]
        };

        // ─── Timing (based on real human interaction rhythms) ───
        this.cooldownMs = 2500;            // Min 2.5s between expression changes (humans hold expressions)
        this.sustainedMs = 500;            // Gesture must be held 500ms before Ü reacts
        this.decayDelayMs = 4000;          // Hold expression 4s before starting decay
        this.decayToPreset = 'mild_attention'; // Decay target (warm neutral, not blank)

        // ─── State ───
        this.lastGesture = 'neutral';
        this.lastConfirmedGesture = 'neutral';
        this.lastResponse = 'neutral';
        this.gestureHistory = [];
        this.historyMaxLen = 10;
        this.lastResponseTime = 0;
        this.mirrorBias = 0.80;            // 80% mirror — humans mostly mirror each other
        this.isActive = false;

        // ─── Sustained Gesture Detection ───
        // A gesture must be detected consistently for sustainedMs before it's "confirmed"
        this._candidateGesture = 'neutral';
        this._candidateStartTime = 0;
        this._candidateConfidence = 0;

        // ─── Expression Decay Timer ───
        this._decayTimer = null;

        // ─── Wink Rarity Counter ───
        // Wink only triggers after many positive interactions (very rare, like real life)
        this._interactionCount = 0;
        this._winkThreshold = 15 + Math.floor(Math.random() * 10); // 15-25 interactions before first wink possible

        // ─── EMA-smoothed blendshape values ───
        this._smoothedBS = null;
        this._smoothAlpha = 0.15;          // Much heavier smoothing (was 0.35) — reduces noise significantly

        // ─── Head pose history for nod detection ───
        this._pitchHistory = [];

        // ─── Callbacks ───
        this.onResponse = null;            // (preset, intensity, meta) => void
        this.onGestureDetected = null;     // (gestureName, confidence) => void
        this.onMicroExpression = null;     // (microType, params) => void
    }

    // ═══════════════════════════════════════════
    // PUBLIC API
    // ═══════════════════════════════════════════

    start() {
        this.isActive = true;
        console.log('🧬 DopamineEngine started (Blendshapes mode — human-realistic timing)');
    }

    stop() {
        this.isActive = false;
        if (this._decayTimer) clearTimeout(this._decayTimer);
        console.log('🧬 DopamineEngine stopped');
    }

    /**
     * Main entry point: feed blendshapes + landmarks every frame.
     * Gesture must be SUSTAINED for 500ms before triggering a response.
     */
    processBlendshapes(blendshapes, landmarks) {
        if (!this.isActive) return;

        // Build blendshape lookup on first frame
        if (blendshapes && !this._blendshapeMap) {
            this._buildBlendshapeMap(blendshapes);
        }

        // Extract features
        const features = this._extractFeatures(blendshapes, landmarks);
        if (!features) return;

        // Classify gesture (per-frame, but NOT acted upon yet)
        const gesture = this._classifyGesture(features);
        const now = Date.now();

        // ─── Sustained Gesture Detection ───
        // The gesture must remain the SAME for sustainedMs before we confirm it
        if (gesture.name !== this._candidateGesture) {
            // New candidate — start the clock
            this._candidateGesture = gesture.name;
            this._candidateStartTime = now;
            this._candidateConfidence = gesture.confidence;
            return; // Don't act yet
        }

        // Same gesture as candidate — update confidence (running average)
        this._candidateConfidence = this._candidateConfidence * 0.7 + gesture.confidence * 0.3;

        // Check if sustained long enough
        const sustainedDuration = now - this._candidateStartTime;
        if (sustainedDuration < this.sustainedMs) {
            return; // Not sustained long enough yet
        }

        // ─── Cooldown Check ───
        if (now - this.lastResponseTime < this.cooldownMs) {
            return; // Still in cooldown from last expression change
        }

        // ─── Confirmed Gesture — React ───
        const confirmedGesture = {
            name: this._candidateGesture,
            confidence: this._candidateConfidence
        };

        // Only react if gesture actually changed from last confirmed
        if (confirmedGesture.name === this.lastConfirmedGesture && confirmedGesture.confidence < 0.85) {
            return; // Same gesture, not strong enough to re-trigger
        }

        this.lastConfirmedGesture = confirmedGesture.name;
        this.lastGesture = confirmedGesture.name;
        this.lastResponseTime = now;
        this._interactionCount++;

        // Track history
        this.gestureHistory.push({ gesture: confirmedGesture.name, time: now, confidence: confirmedGesture.confidence });
        if (this.gestureHistory.length > this.historyMaxLen) {
            this.gestureHistory.shift();
        }

        if (this.onGestureDetected) {
            this.onGestureDetected(confirmedGesture.name, confirmedGesture.confidence);
        }

        // Select dopaminergic response
        const response = this.selectResponse(confirmedGesture);

        // Emit response (only if different from current expression)
        if (this.onResponse && response.preset !== this.lastResponse) {
            this.lastResponse = response.preset;
            this.onResponse(response.preset, response.intensity, {
                userGesture: confirmedGesture.name,
                confidence: confirmedGesture.confidence,
                cosineScore: response.cosineScore,
                dopamine: response.dopamine,
                strategy: response.strategy
            });

            // Schedule gradual decay back to warm neutral
            this._scheduleDecay();
        }

        // Rare micro-expression (only on high-dopamine + high-confidence, and not too often)
        if (response.dopamine > 0.8 && confirmedGesture.confidence > 0.7 && Math.random() < 0.3) {
            this._queueMicroExpression(confirmedGesture.name, response);
        }
    }

    // ═══════════════════════════════════════════
    // EXPRESSION DECAY (gradual return to warm neutral)
    // ═══════════════════════════════════════════

    _scheduleDecay() {
        if (this._decayTimer) clearTimeout(this._decayTimer);

        this._decayTimer = setTimeout(() => {
            // Only decay if no new gesture has been confirmed recently
            const now = Date.now();
            if (now - this.lastResponseTime >= this.decayDelayMs - 100) {
                if (this.onResponse && this.lastResponse !== this.decayToPreset) {
                    this.lastResponse = this.decayToPreset;
                    this.onResponse(this.decayToPreset, 0.5, {
                        userGesture: 'decay',
                        confidence: 1.0,
                        cosineScore: 0,
                        dopamine: 0.4,
                        strategy: 'decay'
                    });
                }
            }
        }, this.decayDelayMs);
    }

    // ═══════════════════════════════════════════
    // BLENDSHAPE MAP
    // ═══════════════════════════════════════════

    _buildBlendshapeMap(categories) {
        this._blendshapeMap = {};
        categories.forEach((cat, idx) => {
            this._blendshapeMap[cat.categoryName] = idx;
        });
        console.log(`🧬 Blendshape map built: ${Object.keys(this._blendshapeMap).length} categories`);
    }

    _bs(categories, name) {
        if (!categories || !this._blendshapeMap) return 0;
        const idx = this._blendshapeMap[name];
        if (idx === undefined) return 0;
        return categories[idx].score || 0;
    }

    // ═══════════════════════════════════════════
    // FEATURE EXTRACTION (Blendshapes + Head Pose)
    // ═══════════════════════════════════════════

    _extractFeatures(blendshapes, landmarks) {
        if (!blendshapes || !this._blendshapeMap) return null;

        // ── Smile (ML-calibrated, 0-1) ──
        const smileL = this._bs(blendshapes, 'mouthSmileLeft');
        const smileR = this._bs(blendshapes, 'mouthSmileRight');
        const smile = (smileL + smileR) / 2;

        // ── Eyebrow Raise (ML-calibrated) ──
        const browInnerUp    = this._bs(blendshapes, 'browInnerUp');
        const browOuterUpL   = this._bs(blendshapes, 'browOuterUpLeft');
        const browOuterUpR   = this._bs(blendshapes, 'browOuterUpRight');
        const eyebrowRaise   = (browInnerUp + browOuterUpL + browOuterUpR) / 3;

        // ── Surprise (mouth open + eyes wide + brows up) ──
        const jawOpen    = this._bs(blendshapes, 'jawOpen');
        const eyeWideL   = this._bs(blendshapes, 'eyeWideLeft');
        const eyeWideR   = this._bs(blendshapes, 'eyeWideRight');
        const surprise   = (jawOpen * 0.4 + ((eyeWideL + eyeWideR) / 2) * 0.3 + eyebrowRaise * 0.3);

        // ── Squint (ML-calibrated) ──
        const squintL = this._bs(blendshapes, 'eyeSquintLeft');
        const squintR = this._bs(blendshapes, 'eyeSquintRight');
        const squint  = (squintL + squintR) / 2;

        // ── Head Pose from landmarks ──
        let headTilt = 0;
        let nodScore = 0;

        if (landmarks && landmarks.length > 454) {
            const nose     = landmarks[1];
            const leftEar  = landmarks[234];
            const rightEar = landmarks[454];
            const chin     = landmarks[152];
            const topHead  = landmarks[10];

            headTilt = Math.abs((rightEar.y - leftEar.y) * 100);

            const pitch = (nose.y - (chin.y + topHead.y) / 2) * 100;
            const now = Date.now();
            this._pitchHistory.push({ p: pitch, t: now });
            this._pitchHistory = this._pitchHistory.filter(h => now - h.t < 400);

            if (this._pitchHistory.length > 3) {
                const oldest = this._pitchHistory[0];
                const velocity = Math.abs(pitch - oldest.p);
                nodScore = velocity;
            }
        }

        // ── Heavy EMA Smoothing (alpha=0.15 — much smoother than before) ──
        const raw = { smile, eyebrowRaise, surprise, squint, headTilt, nodScore };

        if (!this._smoothedBS) {
            this._smoothedBS = { ...raw };
        } else {
            const a = this._smoothAlpha;
            for (const key in raw) {
                this._smoothedBS[key] = a * raw[key] + (1 - a) * this._smoothedBS[key];
            }
        }

        return { ...this._smoothedBS };
    }

    // ═══════════════════════════════════════════
    // GESTURE CLASSIFICATION
    // ═══════════════════════════════════════════

    _classifyGesture(f) {
        const scores = {};

        scores.smile         = this._sigmoid(f.smile,        this.thresholds.smile,        10);
        scores.eyebrow_raise = this._sigmoid(f.eyebrowRaise, this.thresholds.eyebrowRaise, 10);
        scores.surprise      = this._sigmoid(f.surprise,     this.thresholds.surprise,     8);
        scores.squint        = this._sigmoid(f.squint,       this.thresholds.squint,       10);
        scores.head_tilt     = this._sigmoid(f.headTilt,     this.thresholds.headTilt,     0.25);
        scores.nod           = this._sigmoid(f.nodScore,     this.thresholds.nod,          0.6);

        // Neutral: strong bias — default state unless something clearly active
        const maxOther = Math.max(scores.smile, scores.eyebrow_raise, scores.surprise, scores.squint, scores.head_tilt, scores.nod);
        scores.neutral = Math.max(0, 1 - maxOther * 1.2);

        // Winner-take-all with hysteresis: current gesture gets a small bonus to prevent flickering
        let bestGesture = 'neutral';
        let bestScore = scores.neutral;

        for (const [gesture, score] of Object.entries(scores)) {
            // Hysteresis: the current gesture needs to be beaten by a margin
            const hysteresisBonus = (gesture === this._candidateGesture) ? 0.08 : 0;
            const adjustedScore = score + hysteresisBonus;

            if (adjustedScore > bestScore) {
                bestScore = adjustedScore;
                bestGesture = gesture;
            }
        }

        return { name: bestGesture, confidence: Math.min(1, bestScore), allScores: scores };
    }

    // ═══════════════════════════════════════════
    // COSINE SIMILARITY RESPONSE SELECTION
    // ═══════════════════════════════════════════

    selectResponse(gesture) {
        const userVector = this.userGestureVectors[gesture.name];
        if (!userVector) {
            return { preset: 'mild_attention', intensity: 0.5, cosineScore: 0, dopamine: 0.4, strategy: 'fallback' };
        }

        // Strategy: heavily biased toward mirror (80%) — this is how humans actually interact
        const useMirror = Math.random() < this.mirrorBias;
        const strategy = useMirror ? 'mirror' : 'contrast';

        // Compute cosine similarity with all response vectors
        const similarities = [];
        for (const [name, resp] of Object.entries(this.responseVectors)) {
            const cos = this._cosineSimilarity(userVector, resp.vector);
            similarities.push({
                name,
                preset: resp.preset,
                cosine: cos,
                dopamine: resp.dopamine
            });
        }

        if (useMirror) {
            similarities.sort((a, b) => b.cosine - a.cosine);
        } else {
            similarities.sort((a, b) => a.cosine - b.cosine);
        }

        // Blend with dopamine graph
        const graphEdges = this.dopamineGraph[gesture.name] || [];
        let selected = similarities[0];

        if (graphEdges.length > 0) {
            const candidates = similarities.slice(0, 3).map((sim, rank) => {
                const graphEdge = graphEdges.find(e => e.response === sim.name);
                const graphWeight = graphEdge ? graphEdge.weight : 0.05;
                const rankScore = 1 / (rank + 1);
                return {
                    ...sim,
                    combinedScore: rankScore * 0.3 + graphWeight * 0.5 + sim.dopamine * 0.2
                };
            });

            candidates.sort((a, b) => b.combinedScore - a.combinedScore);
            selected = candidates[0];
        }

        // ─── Rare Wink Override (like real human interaction — very occasional) ───
        if (this._interactionCount >= this._winkThreshold && gesture.name === 'smile' && gesture.confidence > 0.75) {
            // Reset counter with new random threshold
            this._interactionCount = 0;
            this._winkThreshold = 12 + Math.floor(Math.random() * 15);
            selected = { preset: 'wink', cosine: 0.9, dopamine: 0.9 };
        }

        const intensity = Math.min(1, gesture.confidence * 0.5 + selected.dopamine * 0.3 + 0.2);

        return {
            preset: selected.preset,
            intensity,
            cosineScore: selected.cosine,
            dopamine: selected.dopamine,
            strategy
        };
    }

    // ═══════════════════════════════════════════
    // MICRO-EXPRESSIONS (rare, subtle)
    // ═══════════════════════════════════════════

    _queueMicroExpression(userGesture, response) {
        // Much more conservative — only subtle, natural micro-expressions
        const micros = {
            smile:         [{ type: 'blink_slow', delay: 600 }],
            surprise:      [{ type: 'eyes_widen', delay: 300 }],
            nod:           [{ type: 'brow_flash', delay: 400 }]
        };

        const queue = micros[userGesture] || [];
        queue.forEach(micro => {
            setTimeout(() => {
                if (this.onMicroExpression) {
                    this.onMicroExpression(micro.type, { gesture: userGesture, response: response.preset });
                }
            }, micro.delay);
        });
    }

    // ═══════════════════════════════════════════
    // MATH UTILITIES
    // ═══════════════════════════════════════════

    _cosineSimilarity(a, b) {
        let dot = 0, magA = 0, magB = 0;
        for (let i = 0; i < a.length; i++) {
            dot  += a[i] * b[i];
            magA += a[i] * a[i];
            magB += b[i] * b[i];
        }
        const denom = Math.sqrt(magA) * Math.sqrt(magB);
        return denom === 0 ? 0 : dot / denom;
    }

    _sigmoid(value, threshold, steepness = 10) {
        return 1 / (1 + Math.exp(-steepness * (value - threshold)));
    }

    // ═══════════════════════════════════════════
    // ADAPTIVE LEARNING
    // ═══════════════════════════════════════════

    reinforceLastInteraction(positive = true) {
        if (positive) {
            if (this.lastResponse === this.lastGesture) {
                this.mirrorBias = Math.min(0.90, this.mirrorBias + 0.01);
            } else {
                this.mirrorBias = Math.max(0.60, this.mirrorBias - 0.01);
            }
        }
    }

    // ═══════════════════════════════════════════
    // DEBUG / INTROSPECTION
    // ═══════════════════════════════════════════

    getState() {
        return {
            lastGesture: this.lastGesture,
            lastConfirmedGesture: this.lastConfirmedGesture,
            lastResponse: this.lastResponse,
            mirrorBias: this.mirrorBias,
            historyLength: this.gestureHistory.length,
            isActive: this.isActive,
            interactionCount: this._interactionCount,
            candidateGesture: this._candidateGesture,
            recentGestures: this.gestureHistory.slice(-5).map(h => h.gesture),
            smoothedBS: this._smoothedBS
        };
    }
}

// Export globally
window.DopamineEngine = DopamineEngine;
