'use strict';

const INTERRUPTION_KINDS = Object.freeze({
    DELIVER_NOW: 'deliver_now',
    SCHEDULE: 'schedule',
    SUPPRESS: 'suppress',
    CLARIFY_WITH_MAIN_ASSISTANT: 'clarify_with_main_assistant'
});

const TRIGGER_KINDS = Object.freeze({
    IMMEDIATE: 'immediate',
    TIME: 'time',
    LOCATION: 'location',
    APP_OPEN: 'app_open',
    KEYWORD: 'keyword',
    AMBIENT_AUDIO: 'ambient_audio',
    MANUAL_WINDOW: 'manual_window',
    AGENT_SIGNAL: 'agent_signal'
});

const DELIVERY_SURFACES = Object.freeze({
    FACE_AUDIO: 'face_audio',
    CHAT: 'chat',
    BANNER: 'banner'
});

const SHIELD_MODES = Object.freeze({
    OS_FOCUS_MODE: 'os_focus_mode'
});

function clampPriority(value, fallback = 50) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(0, Math.min(100, Math.round(numeric)));
}

function sanitizeStringList(value, maxItems = 12) {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .slice(0, maxItems);
}

function normalizeNotificationEnvelope(input = {}) {
    const now = Date.now();
    const sourceApp = String(
        input.sourceApp || input.packageName || input.app || 'unknown'
    ).trim() || 'unknown';
    const title = String(input.title || '').trim();
    const body = String(input.body || input.text || '').trim();

    return {
        id: String(input.id || `notif_${now}_${Math.random().toString(16).slice(2, 8)}`).trim(),
        sourceApp,
        packageName: String(input.packageName || sourceApp).trim() || sourceApp,
        title,
        body,
        threadKey: String(input.threadKey || '').trim(),
        sender: String(input.sender || '').trim(),
        category: String(input.category || 'general').trim() || 'general',
        receivedAt: Number.isFinite(Number(input.receivedAt)) ? Number(input.receivedAt) : now,
        observedAt: Number.isFinite(Number(input.observedAt)) ? Number(input.observedAt) : now,
        priorityHint: clampPriority(input.priorityHint, 50),
        userFacingText: String(input.userFacingText || [title, body].filter(Boolean).join(' — ')).trim(),
        contextTags: sanitizeStringList(input.contextTags, 16),
        raw: input.raw && typeof input.raw === 'object' ? input.raw : null
    };
}

function normalizeTrigger(input = {}) {
    const kind = String(input.kind || TRIGGER_KINDS.IMMEDIATE).trim() || TRIGGER_KINDS.IMMEDIATE;
    return {
        kind,
        at: Number.isFinite(Number(input.at)) ? Number(input.at) : null,
        windowStart: Number.isFinite(Number(input.windowStart)) ? Number(input.windowStart) : null,
        windowEnd: Number.isFinite(Number(input.windowEnd)) ? Number(input.windowEnd) : null,
        locationId: String(input.locationId || '').trim(),
        locationLabel: String(input.locationLabel || '').trim(),
        appId: String(input.appId || '').trim(),
        appName: String(input.appName || '').trim(),
        keywords: sanitizeStringList(input.keywords, 24),
        ambientProfile: String(input.ambientProfile || '').trim(),
        signalKey: String(input.signalKey || '').trim(),
        reasoning: String(input.reasoning || '').trim()
    };
}

function normalizeDeliveryPlan(input = {}) {
    const trigger = normalizeTrigger(input.trigger || input);
    return {
        kind: String(input.kind || INTERRUPTION_KINDS.SCHEDULE).trim() || INTERRUPTION_KINDS.SCHEDULE,
        trigger,
        surface: String(input.surface || DELIVERY_SURFACES.FACE_AUDIO).trim() || DELIVERY_SURFACES.FACE_AUDIO,
        shieldMode: String(input.shieldMode || SHIELD_MODES.OS_FOCUS_MODE).trim() || SHIELD_MODES.OS_FOCUS_MODE,
        speakCue: String(input.speakCue || 'Hey Pss Psss').trim() || 'Hey Pss Psss',
        facePreset: String(input.facePreset || 'mild_attention').trim() || 'mild_attention',
        note: String(input.note || '').trim(),
        expiresAt: Number.isFinite(Number(input.expiresAt)) ? Number(input.expiresAt) : null
    };
}

function normalizeDecision(input = {}) {
    return {
        notificationId: String(input.notificationId || '').trim(),
        kind: String(input.kind || INTERRUPTION_KINDS.SCHEDULE).trim() || INTERRUPTION_KINDS.SCHEDULE,
        importance: clampPriority(input.importance, 50),
        summary: String(input.summary || '').trim(),
        reasoning: String(input.reasoning || '').trim(),
        createdAt: Number.isFinite(Number(input.createdAt)) ? Number(input.createdAt) : Date.now(),
        plan: normalizeDeliveryPlan(input.plan || {}),
        metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {}
    };
}

module.exports = {
    INTERRUPTION_KINDS,
    TRIGGER_KINDS,
    DELIVERY_SURFACES,
    SHIELD_MODES,
    normalizeNotificationEnvelope,
    normalizeTrigger,
    normalizeDeliveryPlan,
    normalizeDecision
};
