(function () {
  const button = document.getElementById('face-bubble-btn');

  function applyState(detail = {}) {
    const level = Number(detail.level || 0);
    const visible = Boolean(detail.visible);
    document.body.classList.toggle('is-hidden', !visible);
    document.body.classList.toggle('is-live', visible);
    button.setAttribute('aria-hidden', visible ? 'false' : 'true');
    button.dataset.level = String(level);
  }

  window.addEventListener('iu-bubble-state', (event) => {
    applyState(event.detail || {});
  });

  button.addEventListener('click', () => {
    if (window.AndroidHost?.vibrateLight) {
      window.AndroidHost.vibrateLight();
    }
    if (window.AndroidHost?.switchLevel) {
      const currentLevel = Number(button.dataset.level || '0');
      window.AndroidHost.switchLevel(currentLevel === 0 ? 1 : 0);
    }
  });

  applyState({ visible: false, level: 0 });
})();
