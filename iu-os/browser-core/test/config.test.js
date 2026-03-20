const test = require('node:test');
const assert = require('node:assert/strict');

const { createBrowserCoreConfig, DEFAULT_BROWSER_SERVICE_PORT } = require('../dist/config.js');

test('createBrowserCoreConfig builds managed and user profiles', () => {
    const config = createBrowserCoreConfig({ authToken: 'token-1' });

    assert.equal(config.enabled, true);
    assert.equal(config.authToken, 'token-1');
    assert.equal(config.defaultProfile, 'managed');
    assert.equal(config.servicePort, DEFAULT_BROWSER_SERVICE_PORT);
    assert.equal(config.profiles.managed.name, 'managed');
    assert.equal(config.profiles.user.name, 'user');
    assert.equal(config.profiles.managed.driver, 'managed-cdp');
    assert.equal(config.profiles.user.driver, 'user-existing-session');
});
