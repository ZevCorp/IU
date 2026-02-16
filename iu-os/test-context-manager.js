const assert = require('assert');
const contextManager = require('./ContextManager');

console.log('🧪 Testing ContextManager...');

// Test 1: Add messages
contextManager.addMessage('user', 'Hello U', 'chat_ui');
contextManager.addMessage('assistant', 'Hi there', 'chat_api');
contextManager.addMessage('user', 'Open Calculator', 'voice_transcription');

assert.strictEqual(contextManager.history.length, 3, 'History size should be 3');
assert.strictEqual(contextManager.history[0].text, 'Hello U', 'First message match');
assert.strictEqual(contextManager.history[2].source, 'voice_transcription', 'Source match');
console.log('✅ Test 1: Add messages passed');

// Test 2: Get History for API
const apiHistory = contextManager.getHistoryForAPI(2);
assert.strictEqual(apiHistory.length, 2, 'Should return last 2');
assert.strictEqual(apiHistory[0].role, 'assistant', 'Role match');
assert.strictEqual(apiHistory[1].content, 'Open Calculator', 'Content match');
console.log('✅ Test 2: Get API history passed');

// Test 3: Get Recent Context Summary
const summary = contextManager.getRecentContextSummary(2);
assert.ok(summary.includes('ASSISTANT: Hi there'), 'Summary contains assistant msg');
assert.ok(summary.includes('USER: Open Calculator'), 'Summary contains user msg');
console.log('✅ Test 3: Context summary passed');

// Test 4: Limits
contextManager.clear();
for (let i = 0; i < 60; i++) {
    contextManager.addMessage('user', `msg ${i}`, 'test');
}
assert.strictEqual(contextManager.history.length, 50, 'Max history limit enforced');
assert.strictEqual(contextManager.history[49].text, 'msg 59', 'Last message preserved');
console.log('✅ Test 4: Limits passed');

console.log('🎉 All tests passed!');
