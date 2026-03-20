const { chromium } = require('playwright-core');
const http = require('http');

async function getWsUrl() {
    return new Promise((resolve) => {
        http.get('http://127.0.0.1:9222/json/version', res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve(JSON.parse(data).webSocketDebuggerUrl));
        }).on('error', () => resolve(null));
    });
}

(async () => {
    const wsUrl = await getWsUrl();
    if(!wsUrl) return console.log("No wsUrl");
    const browser = await chromium.connectOverCDP(wsUrl);
    const context = browser.contexts()[0];
    const page = context.pages()[0];
    
    // Test playwright _snapshotForAI
    try {
        const snap = await page._snapshotForAI();
        console.log("AI Snapshot works! Length:", snap?.full?.length);
    } catch(e) {
        console.log("No _snapshotForAI", e.message);
    }
    await browser.close();
})();
