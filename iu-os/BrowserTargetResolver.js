function extractDirectWebTarget(appName, goal = '', stepsHint = '') {
    const rawHaystack = `${appName || ''} ${goal || ''} ${stepsHint || ''}`.trim();
    if (!rawHaystack) return null;

    const stripTrailingUrlPunctuation = (value) => String(value || '')
        .trim()
        .replace(/[;:.,!?]+$/g, '')
        .replace(/[)\]]+$/g, '');

    const directTargets = [];
    for (const match of rawHaystack.matchAll(/\bhttps?:\/\/[^\s)"'<>]+/gi)) {
        const value = stripTrailingUrlPunctuation(match[0]);
        if (!value) continue;
        directTargets.push({
            kind: 'url',
            index: typeof match.index === 'number' ? match.index : Number.MAX_SAFE_INTEGER,
            value
        });
    }
    for (const match of rawHaystack.matchAll(/\b(?:www\.)?[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+\b/gi)) {
        const value = stripTrailingUrlPunctuation(match[0]);
        if (!value) continue;
        directTargets.push({
            kind: 'domain',
            index: typeof match.index === 'number' ? match.index : Number.MAX_SAFE_INTEGER,
            value
        });
    }
    directTargets.sort((a, b) => {
        if (a.index !== b.index) return a.index - b.index;
        if (a.kind === b.kind) return 0;
        return a.kind === 'url' ? -1 : 1;
    });
    const rawTarget = directTargets.length > 0 ? directTargets[0].value : '';
    if (!rawTarget) return null;

    const normalizedUrl = /^https?:\/\//i.test(rawTarget)
        ? rawTarget
        : `https://${rawTarget}`;

    let hostname = rawTarget;
    try {
        hostname = new URL(normalizedUrl).hostname.replace(/^www\./, '');
    } catch (_) {
        hostname = rawTarget.replace(/^www\./i, '');
    }

    return {
        key: hostname,
        name: hostname,
        url: normalizedUrl,
        domains: [hostname],
        aliases: [hostname]
    };
}

module.exports = {
    extractDirectWebTarget
};
