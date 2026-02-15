const fs = require('fs');
const path = require('path');
const GraphFormalizer = require('./GraphFormalizer');

// Load a sample graph from history
// Adjust the filename to match a real one from your specific history folder
const historyDir = path.join(process.env.HOME, 'Library/Application Support/iu-os/history/graphs');
const files = fs.readdirSync(historyDir).filter(f => f.endsWith('.json'));

if (files.length === 0) {
    console.error("No history graphs found to test with.");
    process.exit(1);
}

// Pick the most recent Calendar graph if available, else the last one
const calendarFile = files.find(f => f.includes('Calendar')) || files[files.length - 1];
const filePath = path.join(historyDir, calendarFile);

console.log(`📂 Loading graph: ${calendarFile}`);
const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
const rawElements = data.elements || [];

console.log(`🔢 Raw elements: ${rawElements.length}`);

// Run formalizer
console.log("🧠 Running GraphFormalizer...");
const start = Date.now();
const optimized = GraphFormalizer.optimize(rawElements);
const time = Date.now() - start;

console.log(`✅ Optimized elements: ${optimized.length}`);
console.log(`⏱️ Time: ${time}ms`);

// Stats
const rawTypes = {};
rawElements.forEach(e => rawTypes[e.type] = (rawTypes[e.type] || 0) + 1);

const optTypes = {};
optimized.forEach(e => optTypes[e.type] = (optTypes[e.type] || 0) + 1);

console.log("\n📊 Type Distribution (Raw -> Optimized):");
const allTypes = new Set([...Object.keys(rawTypes), ...Object.keys(optTypes)]);
allTypes.forEach(t => {
    const r = rawTypes[t] || 0;
    const o = optTypes[t] || 0;
    console.log(`  ${t}: ${r} -> ${o}`);
});

// Show merged nodes
const merged = optimized.filter(e => e.role === 'MergedNode');
console.log(`\n🔗 Merged Nodes (${merged.length}):`);
merged.forEach(m => {
    console.log(`  - "${m.label}" (Type: ${m.type}) [Merged ${m.originalIds.length} items]`);
});
