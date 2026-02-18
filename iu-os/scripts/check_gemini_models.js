require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function listModels() {
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
    // There isn't a direct listModels on the valid instance in some versions, 
    // but usually it's on the class or via a specific manager.
    // Actually, in 0.x SDK, it might not be exposed easily directly via the helper class 
    // without using the underlying API URL fetch.

    // Let's try a direct fetch to the API using the key
    const apiKey = process.env.GOOGLE_API_KEY;
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

    try {
        const response = await fetch(url);
        const data = await response.json();
        if (data.models) {
            console.log('Available Models:');
            data.models.forEach(m => {
                if (m.name.includes('bedding')) {
                    console.log(`- ${m.name} (Supported methods: ${m.supportedGenerationMethods})`);
                }
            });
        } else {
            console.log('No models found or error:', data);
        }
    } catch (e) {
        console.error('Error fetching models:', e.message);
    }
}

listModels();
