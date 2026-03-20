'use strict';

function normalizeText(value) {
    return String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\p{L}\p{N}\s:/._-]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function uniq(values = []) {
    return [...new Set(values.filter(Boolean))];
}

function includesAny(haystack, patterns) {
    return patterns.some((pattern) => haystack.includes(pattern));
}

function extractPotentialApiKeys(input = {}) {
    const explicitCandidates = Array.isArray(input.candidates) ? input.candidates : [];
    const rawText = [
        input.text || '',
        explicitCandidates.join('\n')
    ].join('\n');

    const contextualMatches = [];
    const regexes = [
        /\b(?:api key|secret key|bearer|token)\b[^\n]{0,80}?([A-Za-z0-9][A-Za-z0-9_-]{20,})/gi,
        /\b([A-Za-z0-9][A-Za-z0-9_-]{28,})\b/g
    ];

    for (const regex of regexes) {
        let match;
        while ((match = regex.exec(rawText)) !== null) {
            const candidate = match[1] || match[0];
            if (looksLikeApiKey(candidate)) {
                contextualMatches.push(candidate);
            }
        }
    }

    for (const candidate of explicitCandidates) {
        if (looksLikeApiKey(candidate)) {
            contextualMatches.push(candidate);
        }
    }

    return uniq(contextualMatches).slice(0, 10);
}

function looksLikeApiKey(value) {
    const candidate = String(value || '').trim();
    if (candidate.length < 24 || candidate.length > 256) return false;
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]+$/.test(candidate)) return false;
    if (candidate.includes('http') || candidate.includes('www')) return false;
    if (candidate.toLowerCase().includes('password')) return false;
    return /[A-Z]/.test(candidate) || /[0-9]/.test(candidate) || candidate.includes('_') || candidate.includes('-');
}

function detectInceptionPageState(input = {}) {
    const url = String(input.url || '');
    const normalized = normalizeText([
        input.title || '',
        input.text || '',
        ...(Array.isArray(input.candidates) ? input.candidates : [])
    ].join(' '));
    const potentialApiKeys = extractPotentialApiKeys(input);

    const loginPatterns = [
        'sign in',
        'login',
        'log in',
        'inicia sesion',
        'iniciar sesion',
        'continuar con google',
        'continue with google',
        'continue with github',
        'verify your email',
        'verifica tu correo'
    ];
    const keysPatterns = [
        'api keys',
        'api key',
        'create key',
        'new key',
        'generate key',
        'llaves api',
        'clave api',
        'dashboard'
    ];

    if (potentialApiKeys.length > 0 && includesAny(normalized, ['api key', 'secret key', 'copy', 'copiar', 'bearer', 'llaves api'])) {
        return {
            stage: 'key_visible',
            blocker: 'none',
            requiresUserTurn: false,
            summary: 'Se detecto una posible API key en la pagina.',
            potentialApiKeys
        };
    }

    if (includesAny(normalized, loginPatterns) || /\/(sign-in|login|auth|verify)/i.test(url)) {
        return {
            stage: 'login_required',
            blocker: 'login_required',
            requiresUserTurn: true,
            summary: 'La plataforma requiere autenticacion del usuario.'
        };
    }

    if (includesAny(normalized, keysPatterns) || /api-keys?/i.test(url)) {
        return {
            stage: 'keys_dashboard',
            blocker: 'none',
            requiresUserTurn: false,
            summary: 'La pagina parece ser el dashboard de llaves o una pantalla cercana.'
        };
    }

    if (/inception/i.test(url) || includesAny(normalized, ['inception', 'mercury', 'platform'])) {
        return {
            stage: 'navigating',
            blocker: 'none',
            requiresUserTurn: false,
            summary: 'Seguimos navegando dentro del onboarding de Inception.'
        };
    }

    return {
        stage: 'unknown',
        blocker: 'unknown',
        requiresUserTurn: false,
        summary: 'La pagina actual no ofrece una senal clara todavia.'
    };
}

module.exports = {
    normalizeText,
    extractPotentialApiKeys,
    detectInceptionPageState
};
