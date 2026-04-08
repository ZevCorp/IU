(function () {
  class AudioLoop {
    constructor() {
      this.onWakeWord = null;
      this.onSpeakingState = null;
    }

    async start() {
      return true;
    }

    hasAudio() {
      return false;
    }

    getAudioBuffer() {
      return null;
    }

    setOnWakeWord(callback) {
      this.onWakeWord = callback;
    }

    setOnSpeakingState(callback) {
      this.onSpeakingState = callback;
    }
  }

  window.AudioLoop = AudioLoop;
})();
