const test = require('node:test');
const assert = require('node:assert/strict');

const { extractDirectWebTarget } = require('../BrowserTargetResolver');

test('prefers earliest bare domain over later explicit URL in stepsHint', () => {
    const target = extractDirectWebTarget(
        'Chrome (navegador)',
        'Hacer el trabajo de Business Intelligence',
        '1) Abrir esic.co. 2) Luego abrir https://chatgpt.com/g/g-abc123-esic-worker'
    );

    assert.equal(target?.name, 'esic.co');
    assert.equal(target?.url, 'https://esic.co');
});

test('uses explicit URL when it appears first', () => {
    const target = extractDirectWebTarget(
        'browser',
        '',
        'Abre https://example.org y luego revisa esic.co'
    );

    assert.equal(target?.name, 'example.org');
    assert.equal(target?.url, 'https://example.org');
});
