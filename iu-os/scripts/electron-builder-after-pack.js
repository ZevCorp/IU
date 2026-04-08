'use strict';

const fs = require('fs');
const path = require('path');

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function copyDir(sourceDir, targetDir) {
    if (!fs.existsSync(sourceDir)) {
        throw new Error(`Missing source for afterPack copy: ${sourceDir}`);
    }
    fs.rmSync(targetDir, { recursive: true, force: true });
    ensureDir(path.dirname(targetDir));
    fs.cpSync(sourceDir, targetDir, { recursive: true });
}

function copyFile(sourceFile, targetFile) {
    ensureDir(path.dirname(targetFile));
    fs.copyFileSync(sourceFile, targetFile);
    try {
        fs.chmodSync(targetFile, fs.statSync(sourceFile).mode);
    } catch (_) {
        // Ignore chmod failures.
    }
}

function resolveResourcesDir(context) {
    const productName = context?.packager?.appInfo?.productFilename || 'IU';
    if (context.electronPlatformName === 'darwin') {
        return path.join(context.appOutDir, `${productName}.app`, 'Contents', 'Resources');
    }
    return path.join(context.appOutDir, 'resources');
}

exports.default = async function afterPack(context) {
    const appRoot = context.appDir || process.cwd();
    const resourcesDir = resolveResourcesDir(context);
    const unpackedNodeModules = path.join(resourcesDir, 'app.asar.unpacked', 'node_modules');
    const bundledNodeTarget = path.join(resourcesDir, 'app.asar.unpacked', 'runtime', 'node');

    const copies = [
        {
            from: path.join(appRoot, 'node_modules', 'ajv'),
            to: path.join(unpackedNodeModules, 'ajv'),
        },
        {
            from: path.join(appRoot, 'node_modules', 'ajv-formats'),
            to: path.join(unpackedNodeModules, 'ajv-formats'),
        },
        {
            from: path.join(appRoot, 'node_modules', 'json-schema-traverse'),
            to: path.join(unpackedNodeModules, 'json-schema-traverse'),
        },
        {
            from: path.join(appRoot, 'node_modules', '@mariozechner', 'node_modules', 'ajv'),
            to: path.join(unpackedNodeModules, '@mariozechner', 'node_modules', 'ajv'),
        },
        {
            from: path.join(appRoot, 'node_modules', '@mariozechner', 'node_modules', 'ajv-formats'),
            to: path.join(unpackedNodeModules, '@mariozechner', 'node_modules', 'ajv-formats'),
        },
        {
            from: path.join(appRoot, 'node_modules', '@mariozechner', 'node_modules', 'json-schema-traverse'),
            to: path.join(unpackedNodeModules, '@mariozechner', 'node_modules', 'json-schema-traverse'),
        },
        {
            from: path.join(appRoot, 'node_modules', '@mariozechner', 'pi-ai', 'node_modules', 'ajv'),
            to: path.join(unpackedNodeModules, '@mariozechner', 'pi-ai', 'node_modules', 'ajv'),
        },
        {
            from: path.join(appRoot, 'node_modules', '@mariozechner', 'pi-ai', 'node_modules', 'ajv-formats'),
            to: path.join(unpackedNodeModules, '@mariozechner', 'pi-ai', 'node_modules', 'ajv-formats'),
        },
        {
            from: path.join(appRoot, 'node_modules', '@mariozechner', 'pi-ai', 'node_modules', 'json-schema-traverse'),
            to: path.join(unpackedNodeModules, '@mariozechner', 'pi-ai', 'node_modules', 'json-schema-traverse'),
        },
        {
            from: path.join(appRoot, 'node_modules', '@mariozechner', 'pi-coding-agent', 'node_modules', 'ajv'),
            to: path.join(unpackedNodeModules, '@mariozechner', 'pi-coding-agent', 'node_modules', 'ajv'),
        },
        {
            from: path.join(appRoot, 'node_modules', '@mariozechner', 'pi-coding-agent', 'node_modules', 'json-schema-traverse'),
            to: path.join(unpackedNodeModules, '@mariozechner', 'pi-coding-agent', 'node_modules', 'json-schema-traverse'),
        },
    ];

    for (const item of copies) {
        copyDir(item.from, item.to);
    }

    copyFile(process.execPath, bundledNodeTarget);
    console.log('[afterPack] bundled runtime/node and OpenClaw validator deps');
};
