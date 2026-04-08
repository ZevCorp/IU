(function () {
  class QRConnect {
    constructor(deviceSync) {
      this.deviceSync = deviceSync;
      this.qrContainer = null;
      this.isVisible = false;
    }

    createQRContainer() {
      const existing = document.getElementById('qr-connect-container');
      if (existing) existing.remove();

      const roomId = this.deviceSync.getRoomId() || `room-${Date.now().toString(36)}`;
      if (!this.deviceSync.getRoomId()) {
        this.deviceSync.setRoomId(roomId);
      }

      const container = document.createElement('div');
      container.id = 'qr-connect-container';
      container.innerHTML = `
        <div class="qr-overlay">
          <div class="qr-modal">
            <button class="qr-close" id="qr-close-btn">&times;</button>
            <h2 class="qr-title">Sincroniza con tu desktop</h2>
            <p class="qr-subtitle">Usa este room para compartir notas, metas y estado del launcher.</p>
            <label class="qr-room-label" for="qr-room-input">Room</label>
            <input id="qr-room-input" class="qr-room-input" type="text" value="${roomId}" spellcheck="false" />
            <div class="qr-code-wrapper">
              <div id="qr-target"></div>
            </div>
            <button id="qr-save-room-btn" class="qr-save-room-btn" type="button">Guardar room</button>
            <p class="qr-instruction">El desktop debe unirse al mismo room. Cuando haya otro dispositivo conectado, este estado cambia.</p>
            <div class="qr-devices-status" id="qr-devices-status">
              <span class="status-dot"></span>
              <span class="status-text">Esperando otro dispositivo...</span>
            </div>
          </div>
        </div>
      `;

      const style = document.createElement('style');
      style.textContent = `
        .qr-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.92);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 2200;
          padding: 18px;
        }

        .qr-modal {
          width: min(420px, 100%);
          border-radius: 22px;
          border: 1px solid rgba(255,255,255,0.12);
          background: #0d1014;
          color: #f6f8fb;
          padding: 18px;
          position: relative;
          text-align: center;
        }

        .qr-close {
          position: absolute;
          top: 8px;
          right: 8px;
          width: 34px;
          height: 34px;
          border-radius: 999px;
          border: none;
          background: rgba(255,255,255,0.08);
          color: #fff;
          font-size: 20px;
        }

        .qr-title {
          margin: 0;
          font-size: 22px;
        }

        .qr-subtitle,
        .qr-instruction {
          color: rgba(255,255,255,0.68);
          line-height: 1.55;
        }

        .qr-subtitle {
          margin: 8px 0 14px;
        }

        .qr-room-label {
          display: block;
          text-align: left;
          font-size: 12px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: rgba(255,255,255,0.58);
          margin-bottom: 6px;
        }

        .qr-room-input {
          width: 100%;
          min-height: 46px;
          border-radius: 14px;
          border: 1px solid rgba(255,255,255,0.14);
          background: rgba(255,255,255,0.04);
          color: #fff;
          padding: 0 14px;
          font: 600 14px/1.2 Manrope, sans-serif;
          margin-bottom: 14px;
        }

        .qr-code-wrapper {
          background: #fff;
          padding: 12px;
          border-radius: 18px;
          display: inline-block;
          margin-bottom: 14px;
        }

        #qr-target {
          display: flex;
          justify-content: center;
        }

        .qr-save-room-btn {
          min-height: 42px;
          border-radius: 999px;
          border: none;
          padding: 0 18px;
          background: #fff;
          color: #0d1014;
          font: 700 12px/1 Manrope, sans-serif;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .qr-devices-status {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          margin-top: 12px;
          color: rgba(255,255,255,0.7);
          font-size: 13px;
        }

        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: rgba(255,255,255,0.28);
        }

        .status-dot.connected {
          background: #4ade80;
          box-shadow: 0 0 10px rgba(74, 222, 128, 0.55);
        }
      `;

      container.appendChild(style);
      document.body.appendChild(container);
      return container;
    }

    renderQr() {
      const target = document.getElementById('qr-target');
      if (!target) return;
      target.innerHTML = '';

      const url = this.deviceSync.getConnectionUrl();
      if (!url) return;

      if (typeof QRCode !== 'undefined') {
        new QRCode(target, {
          text: url,
          width: 180,
          height: 180,
          colorDark: '#000000',
          colorLight: '#ffffff',
          correctLevel: QRCode.CorrectLevel.M
        });
        return;
      }

      const fallback = document.createElement('div');
      fallback.style.cssText = 'max-width:180px; word-break:break-all; color:#111; font-size:11px;';
      fallback.textContent = url;
      target.appendChild(fallback);
    }

    updateConnectionStatus(hasDevices) {
      const root = document.getElementById('qr-devices-status');
      if (!root) return;
      const dot = root.querySelector('.status-dot');
      const text = root.querySelector('.status-text');

      if (hasDevices) {
        dot?.classList.add('connected');
        if (text) text.textContent = 'Conectado. El estado ya se puede sincronizar.';
      } else {
        dot?.classList.remove('connected');
        if (text) text.textContent = 'Esperando otro dispositivo...';
      }
    }

    async show() {
      if (this.isVisible) return;

      this.qrContainer = this.createQRContainer();
      this.isVisible = true;
      this.renderQr();
      this.deviceSync.connect();

      document.getElementById('qr-close-btn')?.addEventListener('click', () => this.hide());
      document.getElementById('qr-save-room-btn')?.addEventListener('click', () => {
        const input = document.getElementById('qr-room-input');
        const nextRoom = String(input?.value || '').trim();
        if (!nextRoom) return;
        this.deviceSync.setRoomId(nextRoom);
        this.renderQr();
        this.deviceSync.connect();
      });

      const overlay = this.qrContainer.querySelector('.qr-overlay');
      overlay?.addEventListener('click', (event) => {
        if (event.target === overlay) this.hide();
      });

      this.deviceSync.setOnConnectionChange((connected, devices) => {
        this.updateConnectionStatus(Boolean(connected && devices.length > 0));
      });

      this.updateConnectionStatus(Boolean(this.deviceSync.isConnected() && this.deviceSync.getConnectedDevices().length > 0));
    }

    hide() {
      if (!this.isVisible) return;
      this.qrContainer?.remove();
      this.qrContainer = null;
      this.isVisible = false;
    }

    toggle() {
      if (this.isVisible) {
        this.hide();
      } else {
        this.show();
      }
      if (window.AndroidHost?.vibrateLight) {
        window.AndroidHost.vibrateLight();
      }
    }

    isOpen() {
      return this.isVisible;
    }
  }

  window.QRConnect = QRConnect;
})();
