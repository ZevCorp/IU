/**
 * TurnTakingManager
 *
 * Policy layer above ChatGPT Voice:
 * - Default state is FREE, so ChatGPT decides naturally.
 * - User floor can be acquired once via:
 *   1. thinking activation: gaze up + visible hand
 *   2. interruption: assistant speaking + mouth partially open + visible hand
 * - Once acquired, the user keeps the floor until yielding with a 1s dwell
 *   toward the vector face.
 * - Synthetic "wait" audio should only be active while:
 *   user floor is held, voice mode is active, and there is silence.
 *
 * This manager currently emits state transitions and synthetic wait requests.
 * The actual microphone injection layer can be attached later.
 */

(function () {
  'use strict';

  const DEFAULTS = {
    yieldDwellMs: 1000,
    assistantSpeechHoldMs: 1400,
    localSpeechSilenceMs: 220,
    interruptionPulseMs: 1500,
    postInterruptGraceMs: 2200
  };

  class TurnTakingManager {
    constructor(config = {}) {
      this.config = { ...DEFAULTS, ...config };
      this.debugCallbacks = new Set();
      this.floorCallbacks = new Set();
      this.syntheticWaitCallbacks = new Set();
      this.assistantSpeechTimer = null;
      this.reset();
    }

    reset() {
      this.state = {
        floorState: 'FREE',
        voiceModeActive: false,
        syntheticWaitActive: false,
        assistantSpeaking: false,
        assistantStreaming: false,
        userDetectedByChatGPT: false,
        localUserSpeaking: false,
        localSilenceMs: 0,
        audioLevel: 0,
        attentive: false,
        gazeUp: false,
        gazeY: null,
        mouthPartiallyOpen: false,
        mouthOpenRatio: null,
        handVisible: false,
        thinkingActivationCandidate: false,
        interruptCandidate: false,
        yieldDwellProgress: 0,
        floorReason: null,
        lastFloorChangeAt: 0,
        lastActivationAt: 0
      };

      this.prevThinkingActivationCandidate = false;
      this.prevInterruptCandidate = false;
      this.prevNearInterruptState = '';
      this.yieldDwellStartedAt = 0;
      this.interruptionPulseUntil = 0;
      this.postInterruptGraceUntil = 0;
      this._emitDebug();
    }

    onDebugState(callback) {
      if (typeof callback !== 'function') return () => {};
      this.debugCallbacks.add(callback);
      callback(this.getDebugState());
      return () => this.debugCallbacks.delete(callback);
    }

    onFloorStateChange(callback) {
      if (typeof callback !== 'function') return () => {};
      this.floorCallbacks.add(callback);
      return () => this.floorCallbacks.delete(callback);
    }

    onSyntheticWaitChange(callback) {
      if (typeof callback !== 'function') return () => {};
      this.syntheticWaitCallbacks.add(callback);
      callback(this.state.syntheticWaitActive, this.getDebugState());
      return () => this.syntheticWaitCallbacks.delete(callback);
    }

    setVoiceModeActive(isActive) {
      this.state.voiceModeActive = Boolean(isActive);
      if (!this.state.voiceModeActive) {
        this._setSyntheticWait(false);
      }
      this._recompute();
    }

    updateFaceSignals(face = {}) {
      this.state.attentive = Boolean(face.isAttentive);
      this.state.gazeUp = Boolean(face.gazeUp);
      this.state.gazeY = typeof face.gazeY !== 'undefined' ? Number(face.gazeY) : this.state.gazeY;
      this.state.mouthPartiallyOpen = Boolean(face.mouthPartiallyOpen);
      this.state.mouthOpenRatio = typeof face.mouthOpenRatio !== 'undefined' ? Number(face.mouthOpenRatio) : this.state.mouthOpenRatio;
      this._recompute();
    }

    updateHandSignals(payload = {}) {
      this.state.handVisible = Number(payload.handsCount || 0) > 0;
      this._recompute();
    }

    updateLocalSpeech(payload = {}) {
      this.state.localUserSpeaking = Boolean(payload.isSpeaking);
      this.state.localSilenceMs = Number(payload.silenceMs || 0);
      this.state.audioLevel = Number(payload.level || 0);
      this._recompute();
    }

    updateVoiceActivityHint(payload = {}) {
      this.state.userDetectedByChatGPT = Boolean(payload.userDetectedByChatGPT);
      this.state.assistantStreaming = Boolean(payload.assistantStreaming);
      this.state.assistantSpeaking = this.state.assistantStreaming || this.state.assistantSpeaking;
      this._armAssistantSpeechDecay();
      this._recompute();
    }

    noteAssistantSpeechActivity() {
      this.state.assistantSpeaking = true;
      this._armAssistantSpeechDecay();
      this._recompute();
    }

    noteUserSpeechActivity() {
      this.state.userDetectedByChatGPT = true;
      this._recompute();
      clearTimeout(this.userHintResetTimer);
      this.userHintResetTimer = setTimeout(() => {
        this.state.userDetectedByChatGPT = false;
        this._recompute();
      }, 900);
    }

    acknowledgeForcedInterrupt() {
      this.interruptionPulseUntil = 0;
      this.postInterruptGraceUntil = Date.now() + this.config.postInterruptGraceMs;
      this.state.assistantSpeaking = false;
      this.state.assistantStreaming = false;
      this._setSyntheticWait(false);
      this._emitDebug();
    }

    getDebugState() {
      const considerUserSpeaking = this._considerUserSpeaking();
      return {
        ...this.state,
        interruptPulsing: Date.now() < this.interruptionPulseUntil,
        postInterruptGraceActive: Date.now() < this.postInterruptGraceUntil,
        considerUserSpeaking,
        canInjectWait: this.state.floorState === 'USER_FLOOR_HELD' &&
          this.state.voiceModeActive &&
          !considerUserSpeaking
      };
    }

    _recompute() {
      const thinkingActivationCandidate = this.state.gazeUp && this.state.handVisible;
      const interruptCandidate = this.state.assistantSpeaking && this.state.mouthPartiallyOpen && this.state.handVisible;
      const nearInterrupt =
        this.state.mouthPartiallyOpen || this.state.handVisible || this.state.assistantSpeaking;
      const nearInterruptState = JSON.stringify({
        assistantSpeaking: this.state.assistantSpeaking,
        mouthPartiallyOpen: this.state.mouthPartiallyOpen,
        handVisible: this.state.handVisible,
        assistantStreaming: this.state.assistantStreaming,
        localUserSpeaking: this.state.localUserSpeaking,
        floorState: this.state.floorState
      });

      this.state.thinkingActivationCandidate = thinkingActivationCandidate;
      this.state.interruptCandidate = interruptCandidate;

      if (thinkingActivationCandidate !== this.prevThinkingActivationCandidate) {
        console.log(
          `🧪 [UIUX][turn_taking] thinking_candidate_${thinkingActivationCandidate ? 'on' : 'off'} | ` +
          `gazeUp=${this.state.gazeUp} gazeY=${this.state.gazeY} hand=${this.state.handVisible}`
        );
      }

      if (interruptCandidate !== this.prevInterruptCandidate) {
        console.log(
          `🧪 [UIUX][turn_taking] interrupt_candidate_${interruptCandidate ? 'on' : 'off'} | ` +
          `assistantSpeaking=${this.state.assistantSpeaking} mouthOpen=${this.state.mouthPartiallyOpen} ` +
          `mouthRatio=${this.state.mouthOpenRatio} hand=${this.state.handVisible}`
        );
      } else if (nearInterrupt && nearInterruptState !== this.prevNearInterruptState) {
        console.log('🧪 [UIUX][turn_taking] interrupt_diagnostics', {
          assistantSpeaking: this.state.assistantSpeaking,
          assistantStreaming: this.state.assistantStreaming,
          mouthPartiallyOpen: this.state.mouthPartiallyOpen,
          mouthOpenRatio: this.state.mouthOpenRatio,
          handVisible: this.state.handVisible,
          localUserSpeaking: this.state.localUserSpeaking,
          floorState: this.state.floorState
        });
      }

      if (
        this.state.floorState === 'FREE' &&
        thinkingActivationCandidate &&
        !this.prevThinkingActivationCandidate
      ) {
        this._acquireUserFloor('thinking_activation');
      } else if (
        this.state.floorState === 'FREE' &&
        interruptCandidate &&
        !this.prevInterruptCandidate
      ) {
        this._acquireUserFloor('interruption');
      }

      this.prevThinkingActivationCandidate = thinkingActivationCandidate;
      this.prevInterruptCandidate = interruptCandidate;
      this.prevNearInterruptState = nearInterruptState;

      if (this.state.floorState === 'USER_FLOOR_HELD') {
        if (this.state.attentive) {
          if (!this.yieldDwellStartedAt) this.yieldDwellStartedAt = performance.now();
          const elapsed = performance.now() - this.yieldDwellStartedAt;
          this.state.yieldDwellProgress = Math.max(0, Math.min(1, elapsed / this.config.yieldDwellMs));
          if (elapsed >= this.config.yieldDwellMs) {
            this._releaseUserFloor('yield_dwell');
          }
        } else {
          this.yieldDwellStartedAt = 0;
          this.state.yieldDwellProgress = 0;
        }
      } else {
        this.yieldDwellStartedAt = 0;
        this.state.yieldDwellProgress = 0;
      }

      const shouldInjectWait =
        this.state.voiceModeActive && (
          (
            this.state.floorState === 'USER_FLOOR_HELD' &&
            this.state.floorReason !== 'interruption' &&
            Date.now() >= this.postInterruptGraceUntil &&
            !this._considerUserSpeaking() &&
            this.state.localSilenceMs >= this.config.localSpeechSilenceMs
          )
        );

      this._setSyntheticWait(shouldInjectWait);
      this._emitDebug();
    }

    _considerUserSpeaking() {
      return this.state.localUserSpeaking || this.state.userDetectedByChatGPT;
    }

    _armAssistantSpeechDecay() {
      if (this.assistantSpeechTimer) clearTimeout(this.assistantSpeechTimer);
      this.assistantSpeechTimer = setTimeout(() => {
        this.state.assistantSpeaking = this.state.assistantStreaming;
        this._recompute();
      }, this.config.assistantSpeechHoldMs);
    }

    _acquireUserFloor(reason) {
      this.state.floorState = 'USER_FLOOR_HELD';
      this.state.floorReason = reason;
      this.state.lastFloorChangeAt = Date.now();
      this.state.lastActivationAt = Date.now();
      if (reason === 'interruption') {
        this.interruptionPulseUntil = Date.now() + this.config.interruptionPulseMs;
        this.postInterruptGraceUntil = 0;
      }
      this._emitFloorChange('acquired', reason);
    }

    _releaseUserFloor(reason) {
      this.state.floorState = 'FREE';
      this.state.floorReason = null;
      this.state.lastFloorChangeAt = Date.now();
      this.state.yieldDwellProgress = 0;
      this.interruptionPulseUntil = 0;
      this.postInterruptGraceUntil = 0;
      this._setSyntheticWait(false);
      this._emitFloorChange('released', reason);
    }

    _setSyntheticWait(next) {
      const normalized = Boolean(next);
      if (this.state.syntheticWaitActive === normalized) return;
      this.state.syntheticWaitActive = normalized;
      for (const callback of this.syntheticWaitCallbacks) {
        try {
          callback(normalized, this.getDebugState());
        } catch (_) {
          // ignored
        }
      }
    }

    _emitFloorChange(action, reason) {
      const payload = {
        action,
        reason,
        floorState: this.state.floorState,
        state: this.getDebugState()
      };
      for (const callback of this.floorCallbacks) {
        try {
          callback(payload);
        } catch (_) {
          // ignored
        }
      }
    }

    _emitDebug() {
      const snapshot = this.getDebugState();
      for (const callback of this.debugCallbacks) {
        try {
          callback(snapshot);
        } catch (_) {
          // ignored
        }
      }
    }
  }

  window.TurnTakingManager = TurnTakingManager;
})();
