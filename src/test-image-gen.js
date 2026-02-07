require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function testImageGen() {
    const apiKey = process.env.API_KEY_GEMINI;
    if (!apiKey) {
        console.error('API_KEY_GEMINI not found');
        return;
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const prompt = "Photorealistic close-up shot of a perfectly cooked steak with rosemary, 8k resolution, food photography";

    try {
        console.log('Testing image generation with prompt:', prompt);
        
        // Use the exact model name found in the list
        const imageModel = genAI.getGenerativeModel({ 
            model: 'gemini-2.0-flash-exp-image-generation',
            generationConfig: {
                responseModalities: ['TEXT', 'IMAGE']
            }
        });
        
        const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
        const response = await fetch(url);
        const data = await response.json();
        console.log('Available models:');
        if (data.models) {
            data.models.forEach(m => {
                console.log(`- ${m.name}`);
                console.log(`  Methods: ${m.supportedGenerationMethods?.join(', ')}`);
                console.log(`  Description: ${m.description}`);
            });
        }
        
        const result = await imageModel.generateContent(prompt);
        console.log('Success! Response received.');
        
        if (result.response.candidates && result.response.candidates[0]?.content?.parts) {
            const parts = result.response.candidates[0].content.parts;
            console.log('Parts count:', parts.length);
            for (const part of parts) {
                if (part.inlineData) {
                    console.log('Image generated! MimeType:', part.inlineData.mimeType);
                    console.log('Base64 length:', part.inlineData.data?.length);
                }
            }
        }
    } catch (error) {
        console.error('Error during image generation:');
        console.error('Message:', error.message);
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('StatusText:', error.response.statusText);
        }
    }
}

testImageGen();
