(function () {
  class DopamineEngine {
    getState() {
      return { active: false };
    }

    reinforceLastInteraction() {}
  }

  window.DopamineEngine = DopamineEngine;
})();
