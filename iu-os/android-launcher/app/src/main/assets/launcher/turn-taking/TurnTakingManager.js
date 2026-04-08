(function () {
  class TurnTakingManager {
    onDebugState() {}
    onFloorStateChange() {}
    onSyntheticWaitChange() {}
    setVoiceModeActive() {}
    updateFaceSignals() {}
    updateHandSignals() {}
    updateLocalSpeech() {}
    updateVoiceActivityHint() {}
    noteAssistantSpeechActivity() {}
    noteUserSpeechActivity() {}
    acknowledgeForcedInterrupt() {}
    getDebugState() { return { active: false }; }
  }

  window.TurnTakingManager = TurnTakingManager;
})();
