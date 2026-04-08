(function () {
  class DeviceSync {
    constructor() {
      this.callbacks = {};
      this.bound = false;
    }

    ensureBindings() {
      if (this.bound) return;
      this.bound = true;

      window.IUSyncManager?.onConnectionChange?.((payload = {}) => {
        if (typeof this.callbacks.connection === 'function') {
          this.callbacks.connection(Boolean(payload.connected), Array.isArray(payload.devices) ? payload.devices : []);
        }
      });
    }

    connect() {
      this.ensureBindings();
      window.IUSyncManager?.connect?.();
      const devices = window.IUSyncManager?.getConnectedDevices?.() || [];
      if (typeof this.callbacks.connection === 'function') {
        this.callbacks.connection(Boolean(window.IUSyncManager?.isConnected?.()), devices);
      }
      return Promise.resolve(Boolean(window.IUSyncManager?.isConnected?.()));
    }

    isConnected() {
      return Boolean(window.IUSyncManager?.isConnected?.());
    }

    getConnectedDevices() {
      return window.IUSyncManager?.getConnectedDevices?.() || [];
    }

    getRoomId() {
      return window.IULauncherBridge?.getSyncRoomId?.() || '';
    }

    setRoomId(roomId) {
      return window.IULauncherBridge?.setSyncRoomId?.(roomId) || '';
    }

    getConnectionUrl() {
      return window.IULauncherBridge?.getSyncConnectionUrl?.() || '';
    }

    setOnConnectionChange(callback) {
      this.callbacks.connection = callback;
    }

    setOnRoleChange(callback) {
      this.callbacks.roleChange = callback;
      if (typeof callback === 'function') callback('android-launcher', 'mobile', {});
    }

    setOnFaceReceived(callback) {
      this.callbacks.faceReceived = callback;
    }

    setOnSharedStateChange(callback) {
      this.callbacks.sharedState = callback;
    }

    setOnRequestFace(callback) {
      this.callbacks.requestFace = callback;
    }

    setOnRemoteInstruction(callback) {
      this.callbacks.remoteInstruction = callback;
    }

    setDeviceRole(role) {
      if (typeof this.callbacks.roleChange === 'function') {
        this.callbacks.roleChange('android-launcher', role, {});
      }
    }

    startTransfer() {
      return Promise.resolve({ ok: true });
    }

    broadcastSharedState(sharedState) {
      window.IUSyncManager?.sendSharedState?.(sharedState);
      if (typeof this.callbacks.sharedState === 'function') {
        this.callbacks.sharedState(sharedState || {});
      }
    }
  }

  let instance = null;
  window.getDeviceSync = function getDeviceSync() {
    if (!instance) instance = new DeviceSync();
    return instance;
  };
  window.DeviceSync = DeviceSync;
})();
