/**
 * Restore original (non-obfuscated) JavaScript files
 * Run after building to restore dev environment
 */

const fs = require('fs');
const path = require('path');

const filesToRestore = [
    'main.js',
    'preload.js',
    'renderer/app.js',
    'renderer/sync/DeviceSync.js',
    'renderer/sync/QRConnect.js',
    'renderer/vision/VisionManager.js',
    'renderer/systems/AudioLoop.js',
    'renderer/neural-graph.js'
];

console.log('🔓 Restoring original files...\n');

let restored = 0;

for (const relPath of filesToRestore) {
    const filePath = path.join(__dirname, '..', relPath);
    const backupPath = filePath + '.backup';

    if (fs.existsSync(backupPath)) {
        fs.copyFileSync(backupPath, filePath);
        fs.unlinkSync(backupPath);
        console.log(`✅ Restored: ${relPath}`);
        restored++;
    }
}

console.log(`\n🔓 Restored ${restored} files`);
