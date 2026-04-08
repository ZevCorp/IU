(function () {
  const refs = {
    list: document.getElementById('notification-list'),
    count: document.getElementById('queue-count'),
    simulate: document.getElementById('simulate-btn')
  };

  function formatRelative(timestamp) {
    const minutes = Math.max(0, Math.round((Date.now() - Number(timestamp || Date.now())) / 60000));
    if (minutes < 1) return 'ahora';
    if (minutes === 1) return 'hace 1 min';
    if (minutes < 60) return `hace ${minutes} min`;
    const hours = Math.round(minutes / 60);
    return `hace ${hours} h`;
  }

  function render() {
    const notifications = window.IULauncherBridge.getNotifications();
    refs.count.textContent = `${notifications.length} retenidas`;
    refs.list.innerHTML = '';

    notifications.forEach((item) => {
      const article = document.createElement('article');
      article.className = 'notification-card';
      article.innerHTML = `
        <div class="notification-top">
          <div>
            <div class="notification-app">${item.sourceApp || 'App'}</div>
            <h2 class="notification-title">${item.title || 'Sin titulo'}</h2>
          </div>
          <div class="pill">${item.importance || 50}/100</div>
        </div>
        <p class="notification-body">${item.body || ''}</p>
        <div class="notification-meta">
          <div class="pill">Estado: ${item.status || 'held'}</div>
          <div class="pill">Trigger: ${item.trigger || 'manual'}</div>
          <div class="pill">${formatRelative(item.createdAt)}</div>
        </div>
        <div class="notification-actions">
          <button type="button" data-action="deliver">Mostrar ahora</button>
          <button type="button" data-action="delay">Posponer 15m</button>
        </div>
      `;

      article.querySelector('[data-action="deliver"]').addEventListener('click', () => {
        const next = window.IULauncherBridge.getNotifications().map((notification) => (
          notification.id === item.id ? { ...notification, status: 'delivered', trigger: 'manual_now' } : notification
        ));
        window.IULauncherBridge.setNotifications(next);
        render();
      });

      article.querySelector('[data-action="delay"]').addEventListener('click', () => {
        const next = window.IULauncherBridge.getNotifications().map((notification) => (
          notification.id === item.id ? { ...notification, status: 'scheduled', trigger: 'time +15m' } : notification
        ));
        window.IULauncherBridge.setNotifications(next);
        render();
      });

      refs.list.appendChild(article);
    });
  }

  refs.simulate.addEventListener('click', () => {
    const items = window.IULauncherBridge.getNotifications();
    items.unshift({
      id: `notif_${Date.now()}`,
      sourceApp: 'Telegram',
      title: 'Nueva notificación',
      body: 'Simulación rápida para iterar el filtro.',
      status: 'held',
      trigger: 'esperando ventana de interrupción',
      importance: 67,
      createdAt: Date.now()
    });
    window.IULauncherBridge.setNotifications(items);
    render();
  });

  render();
})();
