/**
 * Obfuscate JavaScript files before building
 * Uses javascript-obfuscator to protect source code
 */

const JavaScriptObfuscator = require('javascript-obfuscator');
const fs = require('fs');
const path = require('path');

// Files to obfuscate
const filesToObfuscate = [
    'main.js',
    'preload.js',
    'renderer/app.js',
    'renderer/sync/DeviceSync.js',
    'renderer/sync/QRConnect.js',
    'renderer/vision/VisionManager.js',
    'renderer/systems/AudioLoop.js',
    'renderer/neural-graph.js'
];

// Obfuscation options (balanced security/performance)
const obfuscatorOptions = {
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.5,
    deadCodeInjection: true,
    deadCodeInjectionThreshold: 0.2,
    debugProtection: false,
    disableConsoleOutput: false, // Keep console for debugging
    identifierNamesGenerator: 'hexadecimal',
    log: false,
    numbersToExpressions: true,
    renameGlobals: false, // Don't rename globals (breaks Electron APIs)
    selfDefending: false,
    simplify: true,
    splitStrings: true,
    splitStringsChunkLength: 10,
    stringArray: true,
    stringArrayCallsTransform: true,
    stringArrayEncoding: ['base64'],
    stringArrayIndexShift: true,
    stringArrayRotate: true,
    stringArrayShuffle: true,
    stringArrayWrappersCount: 2,
    stringArrayWrappersChainedCalls: true,
    stringArrayWrappersParametersMaxCount: 4,
    stringArrayWrappersType: 'function',
    stringArrayThreshold: 0.75,
    transformObjectKeys: true,
    unicodeEscapeSequence: false
};

console.log('🔒 Starting code obfuscation...\n');

let successCount = 0;
let errorCount = 0;

for (const relPath of filesToObfuscate) {
    const filePath = path.join(__dirname, '..', relPath);

    if (!fs.existsSync(filePath)) {
        console.log(`⚠️  Skipped (not found): ${relPath}`);
        continue;
    }

    try {
        const code = fs.readFileSync(filePath, 'utf8');
        const obfuscated = JavaScriptObfuscator.obfuscate(code, obfuscatorOptions);

        // Backup original
        const backupPath = filePath + '.backup';
        if (!fs.existsSync(backupPath)) {
            fs.writeFileSync(backupPath, code);
        }

        // Write obfuscated
        fs.writeFileSync(filePath, obfuscated.getObfuscatedCode());

        console.log(`✅ Obfuscated: ${relPath}`);
        successCount++;
    } catch (err) {
        console.error(`❌ Error obfuscating ${relPath}:`, err.message);
        errorCount++;
    }
}

console.log(`\n🔒 Obfuscation complete: ${successCount} files processed, ${errorCount} errors`);

if (errorCount > 0) {
    process.exit(1);
}
