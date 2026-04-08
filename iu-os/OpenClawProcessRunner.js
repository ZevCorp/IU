'use strict';

const { execFile, spawn } = require('child_process');
const path = require('path');
const {
    resolveOpenClawNodePath,
} = require('./OpenClawPackageResolver');

function buildLaunchEnv(baseEnv = process.env, cliPath = '', nodePath = '') {
    const env = {
        ...baseEnv,
    };
    const preferredDirs = [];
    const cliDir = path.dirname(String(cliPath || '').trim());
    const nodeDir = path.dirname(String(nodePath || '').trim());
    if (nodeDir) preferredDirs.push(nodeDir);
    if (cliDir && cliDir !== nodeDir) preferredDirs.push(cliDir);

    if (preferredDirs.length > 0) {
        const currentPath = String(env.PATH || '');
        const entries = currentPath.split(path.delimiter).filter(Boolean);
        env.PATH = [
            ...preferredDirs,
            ...entries.filter((entry) => !preferredDirs.includes(entry)),
        ].join(path.delimiter);
    }

    return env;
}

function buildLaunchSpec(cliPath, cliArgs = [], options = {}) {
    const resolvedCliPath = String(cliPath || '').trim();
    if (!resolvedCliPath) {
        throw new Error('No encontré el CLI de OpenClaw');
    }
    const nodePath = String(options.nodePath || resolveOpenClawNodePath(resolvedCliPath)).trim();
    return {
        command: nodePath,
        args: [resolvedCliPath, ...cliArgs],
        env: buildLaunchEnv(options.env || process.env, resolvedCliPath, nodePath),
        nodePath,
    };
}

function execOpenClawCli(cliPath, cliArgs = [], options = {}) {
    const launch = buildLaunchSpec(cliPath, cliArgs, options);
    return new Promise((resolve, reject) => {
        execFile(launch.command, launch.args, {
            env: launch.env,
            timeout: options.timeout,
            maxBuffer: options.maxBuffer || 8 * 1024 * 1024,
            cwd: options.cwd,
        }, (error, stdout, stderr) => {
            if (error) {
                const detail = String(stderr || stdout || error.message || '').trim();
                reject(new Error(detail || error.message || 'OpenClaw CLI command failed'));
                return;
            }
            resolve({
                stdout: String(stdout || ''),
                stderr: String(stderr || ''),
                nodePath: launch.nodePath,
            });
        });
    });
}

function spawnOpenClawProcess(cliPath, cliArgs = [], options = {}) {
    const launch = buildLaunchSpec(cliPath, cliArgs, options);
    const child = spawn(launch.command, launch.args, {
        env: launch.env,
        cwd: options.cwd,
        stdio: options.stdio || ['ignore', 'pipe', 'pipe'],
    });
    child.openClawNodePath = launch.nodePath;
    return child;
}

module.exports = {
    buildLaunchEnv,
    buildLaunchSpec,
    execOpenClawCli,
    spawnOpenClawProcess,
};
