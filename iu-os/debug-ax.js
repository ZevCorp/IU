const SimpleAxAgent = require('./SimpleAxAgent'); // Default export
const fs = require('fs');

async function run() {
    console.log('🍎 Starting debug AX extraction...');
    const agent = new SimpleAxAgent(); // No destructuring

    try {
        // Force calculation on Calculator
        const result = await agent.extract('Calculator');

        console.log('✅ Extraction complete');
        console.log('App:', result.app);
        console.log('Window:', result.window);
        console.log('Elements found:', result.snapshot.length);

        if (result.snapshot.length > 0) {
            console.log('--- First 5 Elements ---');
            result.snapshot.slice(0, 5).forEach(e => {
                console.log(`ID: ${e.id}, Type: ${e.type}, Label: ${e.label}`);
                console.log(`BBox: ${JSON.stringify(e.bbox)}`);
            });

            // Find key "5"
            const key5 = result.snapshot.find(e => e.label === '5' || e.label === '5');
            if (key5) {
                console.log('--- Key 5 Found ---');
                console.log(JSON.stringify(key5, null, 2));
            } else {
                console.log('--- Key 5 NOT Found ---');
            }
        }

    } catch (e) {
        console.error('❌ Error:', e);
    }
}

run();
