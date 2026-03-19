const { spawnSync } = require('child_process');

if (process.platform !== 'darwin') {
    console.log('[postinstall] Skipping node-gyp rebuild (native AX addon is macOS-only).');
    process.exit(0);
}

console.log('[postinstall] Building native macOS AX addon with node-gyp...');
const result = spawnSync('node-gyp', ['rebuild'], { stdio: 'inherit', shell: true });

if (result.status !== 0) {
    process.exit(result.status || 1);
}
