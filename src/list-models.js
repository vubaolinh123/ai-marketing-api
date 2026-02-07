require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function listModels() {
    const apiKey = process.env.API_KEY_GEMINI;
    if (!apiKey) {
        console.error('API_KEY_GEMINI not found');
        return;
    }

    const genAI = new GoogleGenerativeAI(apiKey);

    try {
        const result = await genAI.listModels();
        console.log('Available models:');
        result.models.forEach(model => {
            console.log(`- ${model.name} (${model.displayName})`);
            console.log(`  Supported methods: ${model.supportedGenerationMethods.join(', ')}`);
        });
    } catch (error) {
        console.error('Error listing models:', error);
    }
}

listModels();
