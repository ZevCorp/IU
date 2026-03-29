'use strict';

const {
    normalizeNotificationEnvelope,
    normalizeDecision
} = require('./TimeManagerContracts');

class TimeManagerStore {
    constructor(options = {}) {
        this.maxNotifications = Math.max(20, Number(options.maxNotifications || 500));
        this.notifications = [];
        this.decisions = [];
    }

    ingestNotification(input = {}) {
        const envelope = normalizeNotificationEnvelope(input);
        this.notifications.unshift(envelope);
        if (this.notifications.length > this.maxNotifications) {
            this.notifications.length = this.maxNotifications;
        }
        return envelope;
    }

    saveDecision(input = {}) {
        const decision = normalizeDecision(input);
        this.decisions.unshift(decision);
        if (this.decisions.length > this.maxNotifications) {
            this.decisions.length = this.maxNotifications;
        }
        return decision;
    }

    getNotification(notificationId) {
        return this.notifications.find((item) => item.id === notificationId) || null;
    }

    getRecentNotifications(limit = 12) {
        return this.notifications.slice(0, Math.max(1, Math.min(100, Number(limit) || 12)));
    }

    getRecentDecisions(limit = 12) {
        return this.decisions.slice(0, Math.max(1, Math.min(100, Number(limit) || 12)));
    }
}

module.exports = TimeManagerStore;
