const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// Mock electron app.getPath for testing environment
// Since we are running with node, not electron, we need to mock this if not present
if (!app) {
    const mockApp = {
        getPath: (name) => {
            if (name === 'home') return process.env.HOME || '/Users/felipemaldonado';
            if (name === 'userData') return '/tmp';
            return '/tmp';
        }
    };
    require.cache[require.resolve('electron')] = {
        exports: { app: mockApp }
    };
}

const memoryFS = require('./MemoryFileSystem');
const contextManager = require('./ContextManager');

console.log('🧪 Testing Memory System...');

async function runTests() {
    // Test 1: MemoryFileSystem Directory Creation
    console.log('Checking brain directories...');
    assert.ok(fs.existsSync(memoryFS.brainDir), 'Brain dir exists');
    assert.ok(fs.existsSync(memoryFS.episodicDir), 'Episodic dir exists');
    assert.ok(fs.existsSync(path.join(memoryFS.brainDir, 'MEMORY.md')), 'Core memory exists');
    console.log('✅ Test 1: Directories created');

    // Test 2: Persisting Context
    console.log('Testing context persistence...');
    const testMsg = `Test message ${Date.now()}`;

    // This calls memoryFS.appendToDailyLog
    contextManager.addMessage('user', testMsg, 'test_script');

    // Wait for file I/O
    await new Promise(r => setTimeout(r, 100));

    const today = new Date().toISOString().split('T')[0];
    const logPath = path.join(memoryFS.episodicDir, `${today}.md`);

    assert.ok(fs.existsSync(logPath), 'Daily log file exists');
    const content = fs.readFileSync(logPath, 'utf-8');
    assert.ok(content.includes(testMsg), 'Log contains test message');
    assert.ok(content.includes('test_script'), 'Log contains source');
    console.log('✅ Test 2: Context persisted to disk');

    // Test 3: Core Memory Read
    const core = memoryFS.getCoreMemory();
    assert.ok(core.includes('# Core Memory'), 'Read core memory header');
    console.log('✅ Test 3: Core memory read');

    console.log('🎉 All persistence tests passed!');
}

runTests().catch(e => {
    console.error('❌ Test failed:', e);
    process.exit(1);
});
