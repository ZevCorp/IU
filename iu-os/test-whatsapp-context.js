const fs = require('fs');
const path = require('path');
const WhatsAppContext = require('./WhatsAppContext');

// Path to persistent map
const mapPath = path.join(process.env.HOME, 'Library/Application Support/iu-os/persistent_maps/_WhatsApp_map.json');

try {
    const data = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
    const windowName = Object.keys(data.windows)[0]; // "WhatsApp"
    const elements = data.windows[windowName].nodes;

    console.log(`Loaded ${elements.length} elements from ${mapPath}`);

    // Run parser
    const context = WhatsAppContext.parse(elements);

    console.log('\n--- PARSED CONTEXT ---');
    console.log(WhatsAppContext.formatForPrompt(context));

    console.log('\n--- ANALYSIS ---');
    console.log(JSON.stringify(context.analysis, null, 2));

} catch (e) {
    console.error('Test failed:', e.message);
}
