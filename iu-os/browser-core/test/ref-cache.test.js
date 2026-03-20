const test = require('node:test');
const assert = require('node:assert/strict');

const { BrowserRefCache } = require('../dist/ref-cache.js');

test('BrowserRefCache keeps refs stable for the same target and element keys', () => {
    const cache = new BrowserRefCache();
    const first = cache.apply('managed', 'target-1', [
        {
            key: '#submit',
            role: 'button',
            label: 'Submit',
            selector: '#submit',
            tag: 'button'
        }
    ]);

    const second = cache.apply('managed', 'target-1', [
        {
            key: '#submit',
            role: 'button',
            label: 'Submit',
            selector: '#submit',
            tag: 'button'
        }
    ]);

    assert.equal(first[0].ref, 'e1');
    assert.equal(second[0].ref, 'e1');
    assert.equal(cache.resolve('managed', 'target-1', 'e1').selector, '#submit');
});
