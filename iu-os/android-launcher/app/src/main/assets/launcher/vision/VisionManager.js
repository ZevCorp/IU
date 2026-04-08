(function () {
  class DummyDopamineEngine {
    constructor() {
      this.onMicroExpression = null;
    }

    getState() {
      return { active: false };
    }

    reinforceLastInteraction() {}
  }

  class VisionManager {
    constructor() {
      this.state = { isAttentive: false };
      this.dopamineEngine = new DummyDopamineEngine();
    }

    initDopamineEngine() {}
    getDopamineEngine() { return this.dopamineEngine; }
    setWindowPosition() {}
    setDeepAttention() {}
    start() {}
    stop() {}
    setOnDopamineResponse(callback) { this.onDopamineResponse = callback; }
    setOnFaceUpdate(callback) { this.onFaceUpdate = callback; }
    setOnAttentionChange(callback) { this.onAttentionChange = callback; }
    setOnGesture(callback) { this.onGesture = callback; }
  }

  window.VisionManager = VisionManager;
})();
