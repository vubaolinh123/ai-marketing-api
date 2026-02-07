/**
 * Gemini AI Configuration
 * Centralized configuration for all Gemini AI services
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

// Validate API key
if (!process.env.API_KEY_GEMINI) {
    console.warn('Warning: API_KEY_GEMINI not found in environment variables');
}

// Initialize Gemini client
const genAI = new GoogleGenerativeAI(process.env.API_KEY_GEMINI);

// Model configurations
const MODELS = {
    TEXT: 'gemini-2.0-flash',           // Fast text generation
    VISION: 'gemini-2.0-flash',          // Vision + text
    IMAGE_GEN: 'gemini-2.0-flash-exp-image-generation'    // Native image generation (experimental)
};

// Purpose labels for prompts
const PURPOSE_LABELS = {
    introduce: 'giới thiệu sản phẩm/dịch vụ',
    sell: 'bán hàng/khuyến mãi',
    share_knowledge: 'chia sẻ kiến thức'
};

/**
 * Get model instance by type
 * @param {string} type - Model type (TEXT, VISION, IMAGE_GEN)
 * @param {string} customModelName - Optional custom model name override from user settings
 * @returns {Object} Model instance
 */
function getModel(type, customModelName = null) {
    const modelName = customModelName || MODELS[type] || MODELS.TEXT;
    return genAI.getGenerativeModel({ model: modelName });
}

/**
 * Parse JSON from AI response
 * @param {string} text - Response text
 * @returns {Object|null} Parsed JSON or null
 */
function parseJsonResponse(text) {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
        try {
            return JSON.parse(jsonMatch[0]);
        } catch (error) {
            console.error('JSON parse error:', error);
            return null;
        }
    }
    return null;
}

module.exports = {
    genAI,
    MODELS,
    PURPOSE_LABELS,
    getModel,
    parseJsonResponse
};
