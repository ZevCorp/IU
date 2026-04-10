const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const OpenClawSupervisorBridge = require('../OpenClawSupervisorBridge');

async function withEnv(overrides, fn) {
    const previous = {};
    for (const [key, value] of Object.entries(overrides)) {
        previous[key] = process.env[key];
        if (value == null) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }
    try {
        return await fn();
    } finally {
        for (const [key, value] of Object.entries(previous)) {
            if (value == null) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    }
}

function createFakeOpenClawPackage(rootDir, version = '2099.1.1') {
    fs.mkdirSync(path.join(rootDir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(rootDir, 'openclaw.mjs'), '#!/usr/bin/env node\nconsole.log("openclaw");\n', 'utf8');
    fs.writeFileSync(
        path.join(rootDir, 'package.json'),
        JSON.stringify({ name: 'openclaw', version }, null, 2),
        'utf8'
    );
}

function createFakeNodeBinary(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
}

test('installs an IU-managed OpenClaw runtime when no external installation exists', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'iu-openclaw-supervisor-'));
    const bundledPackageRoot = path.join(tmpRoot, 'bundled-openclaw');
    const bundledNodePath = path.join(tmpRoot, 'bundled-node', 'node');
    createFakeOpenClawPackage(bundledPackageRoot, '2026.9.1');
    createFakeNodeBinary(bundledNodePath);

    await withEnv({
        IU_OPENCLAW_PACKAGE_ROOT: bundledPackageRoot,
        IU_OPENCLAW_NODE_PATH: bundledNodePath,
        IU_OPENCLAW_CLI_PATH: null,
        PATH: '',
        HOME: path.join(tmpRoot, 'home'),
    }, async () => {
        const bridge = new OpenClawSupervisorBridge({
            userDataPath: path.join(tmpRoot, 'user-data'),
            manageLaunchAgent: false,
        });

        const install = await bridge.ensureInstalled();

        assert.equal(install.installedByIU, true);
        assert.equal(fs.existsSync(install.cliPath), true);
        assert.equal(fs.existsSync(install.nodePath), true);
        assert.equal(fs.existsSync(bridge.getManagedManifestPath()), true);
        assert.equal(fs.existsSync(bridge.getManagedCleanupScriptPath()), true);
        assert.equal(fs.existsSync(bridge.getManagedInstallRoot()), false);

        const manifest = JSON.parse(fs.readFileSync(bridge.getManagedManifestPath(), 'utf8'));
        assert.equal(manifest.installedByIU, true);
        assert.equal(manifest.version, '2026.9.1');
        assert.equal(manifest.source, 'iu-bundled');
        assert.equal(manifest.cliPath, path.join(bundledPackageRoot, 'openclaw.mjs'));
        assert.equal(manifest.nodePath, bundledNodePath);
    });
});

test('uses the bundled managed OpenClaw installation even if external hints exist in env', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'iu-openclaw-supervisor-'));
    const externalPackageRoot = path.join(tmpRoot, 'external-openclaw');
    const externalCliPath = path.join(externalPackageRoot, 'openclaw.mjs');
    const externalNodePath = path.join(tmpRoot, 'external-node', 'node');
    const bundledPackageRoot = path.join(tmpRoot, 'bundled-openclaw');
    const bundledNodePath = path.join(tmpRoot, 'bundled-node', 'node');
    createFakeOpenClawPackage(externalPackageRoot, '2026.4.2');
    createFakeNodeBinary(externalNodePath);
    createFakeOpenClawPackage(bundledPackageRoot, '2026.9.1');
    createFakeNodeBinary(bundledNodePath);

    await withEnv({
        IU_OPENCLAW_CLI_PATH: externalCliPath,
        IU_OPENCLAW_NODE_PATH: externalNodePath,
        IU_OPENCLAW_PACKAGE_ROOT: bundledPackageRoot,
        IU_OPENCLAW_NODE_PATH: bundledNodePath,
        PATH: '',
        HOME: path.join(tmpRoot, 'home'),
    }, async () => {
        const bridge = new OpenClawSupervisorBridge({
            userDataPath: path.join(tmpRoot, 'user-data'),
            manageLaunchAgent: false,
        });

        const install = await bridge.ensureInstalled();

        assert.equal(install.installedByIU, true);
        assert.equal(install.source, 'iu-bundled');
        assert.equal(fs.realpathSync(install.cliPath), fs.realpathSync(path.join(bundledPackageRoot, 'openclaw.mjs')));
        assert.equal(install.nodePath, bundledNodePath);
        assert.equal(fs.existsSync(bridge.getManagedManifestPath()), true);
    });
});

test('uninstalls only the IU-managed runtime and clears its state files', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'iu-openclaw-supervisor-'));
    const bundledPackageRoot = path.join(tmpRoot, 'bundled-openclaw');
    const bundledNodePath = path.join(tmpRoot, 'bundled-node', 'node');
    createFakeOpenClawPackage(bundledPackageRoot, '2026.9.1');
    createFakeNodeBinary(bundledNodePath);

    await withEnv({
        IU_OPENCLAW_PACKAGE_ROOT: bundledPackageRoot,
        IU_OPENCLAW_NODE_PATH: bundledNodePath,
        IU_OPENCLAW_CLI_PATH: null,
        PATH: '',
        HOME: path.join(tmpRoot, 'home'),
    }, async () => {
        const bridge = new OpenClawSupervisorBridge({
            userDataPath: path.join(tmpRoot, 'user-data'),
            manageLaunchAgent: false,
        });

        const install = await bridge.ensureInstalled();
        fs.mkdirSync(install.stateDir, { recursive: true });
        fs.writeFileSync(path.join(install.stateDir, 'openclaw.json'), '{}\n', 'utf8');

        const result = await bridge.uninstallManagedInstall();

        assert.equal(result.removed, true);
        assert.equal(fs.existsSync(bridge.getManagedManifestPath()), false);
        assert.equal(fs.existsSync(bridge.getManagedInstallRoot()), false);
        assert.equal(fs.existsSync(install.stateDir), false);
        assert.equal(fs.existsSync(install.packageRoot), true);
    });
});

test('refreshes the managed manifest when the bundled OpenClaw version changes', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'iu-openclaw-supervisor-'));
    const bundledPackageRoot = path.join(tmpRoot, 'bundled-openclaw');
    const bundledNodePath = path.join(tmpRoot, 'bundled-node', 'node');
    createFakeOpenClawPackage(bundledPackageRoot, '2026.9.1');
    createFakeNodeBinary(bundledNodePath);

    await withEnv({
        IU_OPENCLAW_PACKAGE_ROOT: bundledPackageRoot,
        IU_OPENCLAW_NODE_PATH: bundledNodePath,
        IU_OPENCLAW_CLI_PATH: null,
        PATH: '',
        HOME: path.join(tmpRoot, 'home'),
    }, async () => {
        const bridge = new OpenClawSupervisorBridge({
            userDataPath: path.join(tmpRoot, 'user-data'),
            manageLaunchAgent: false,
        });

        const firstInstall = await bridge.ensureInstalled();
        assert.equal(firstInstall.version, '2026.9.1');

        createFakeOpenClawPackage(bundledPackageRoot, '2026.10.4');
        const secondInstall = await bridge.ensureInstalled();
        const manifest = JSON.parse(fs.readFileSync(bridge.getManagedManifestPath(), 'utf8'));

        assert.equal(secondInstall.version, '2026.10.4');
        assert.equal(manifest.version, '2026.10.4');
        assert.equal(manifest.source, 'iu-bundled');
        assert.equal(manifest.cliPath, path.join(bundledPackageRoot, 'openclaw.mjs'));
    });
});
