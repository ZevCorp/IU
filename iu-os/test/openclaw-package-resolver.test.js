const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { resolveOpenClawPackageRoot } = require('../OpenClawPackageResolver');

test('prefers the app local openclaw package over a cli-derived global package root', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'iu-openclaw-resolver-'));
    const fakePackageRoot = path.join(tmpRoot, 'fake-global-openclaw');
    const fakeCliPath = path.join(fakePackageRoot, 'openclaw.mjs');

    fs.mkdirSync(path.join(fakePackageRoot, 'dist'), { recursive: true });
    fs.writeFileSync(fakeCliPath, '#!/usr/bin/env node\n', 'utf8');

    const resolved = resolveOpenClawPackageRoot({ cliPath: fakeCliPath });
    const expected = path.dirname(path.dirname(require.resolve('openclaw')));

    assert.equal(resolved, expected);
});
