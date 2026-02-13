/**
 * Gemini AI Configuration
 * Centralized configuration for all Gemini AI services
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { MODEL_RECOMMENDATIONS, DEFAULT_MODELS } = require('./modelConfig.service');

// Validate API key
if (!process.env.API_KEY_GEMINI) {
    console.warn('Warning: API_KEY_GEMINI not found in environment variables');
}

// Initialize Gemini client
const genAI = new GoogleGenerativeAI(process.env.API_KEY_GEMINI);

// Model configurations
const MODELS = {
    TEXT: DEFAULT_MODELS.text || 'gemini-2.0-flash',
    VISION: DEFAULT_MODELS.vision || 'gemini-2.0-flash',
    IMAGE_GEN: DEFAULT_MODELS.imageGen || 'gemini-2.0-flash-exp-image-generation'
};

// Purpose labels for prompts
const PURPOSE_LABELS = {
    introduce: 'giới thiệu sản phẩm/dịch vụ',
    sell: 'bán hàng/khuyến mãi',
    share_knowledge: 'chia sẻ kiến thức',
    brand_awareness: 'tăng nhận diện thương hiệu',
    attract_leads: 'thu hút khách hàng tiềm năng',
    nurture_educate: 'nuôi dưỡng và giáo dục khách hàng',
    convert_sales: 'chuyển đổi bán hàng',
    retention_loyalty: 'duy trì và tăng trung thành',
    brand_positioning: 'định vị thương hiệu'
};

/**
 * Get model instance by type
 * @param {string} type - Model type (TEXT, VISION, IMAGE_GEN)
 * @param {string} customModelName - Optional custom model name override from user settings
 * @returns {Object} Model instance
 */
function getModel(type, customModelName = null) {
    const modelName = resolveModelName(type, customModelName);

    try {
        return genAI.getGenerativeModel({ model: modelName });
    } catch (error) {
        const fallbackModelName = MODELS[normalizeModelType(type)] || MODELS.TEXT;
        console.error('Gemini model init failed, fallback to default model:', error);
        return genAI.getGenerativeModel({ model: fallbackModelName });
    }
}

function normalizeModelType(type) {
    if (!type) return 'TEXT';
    const normalized = String(type).trim().toUpperCase();
    return MODELS[normalized] ? normalized : 'TEXT';
}

function toTaskType(type) {
    const typeMap = {
        TEXT: 'text',
        VISION: 'vision',
        IMAGE_GEN: 'imageGen'
    };
    return typeMap[normalizeModelType(type)] || 'text';
}

function getKnownModelsForTask(taskType) {
    const known = new Set();
    const recommendations = MODEL_RECOMMENDATIONS[taskType] || [];

    for (const item of recommendations) {
        if (item && item.modelId) {
            known.add(item.modelId);
        }
    }

    if (DEFAULT_MODELS[taskType]) {
        known.add(DEFAULT_MODELS[taskType]);
    }

    return known;
}

function resolveModelName(type, customModelName = null) {
    const normalizedType = normalizeModelType(type);
    const fallbackModelName = MODELS[normalizedType] || MODELS.TEXT;

    if (typeof customModelName !== 'string' || !customModelName.trim()) {
        return fallbackModelName;
    }

    const requestedModel = customModelName.trim();
    const taskType = toTaskType(normalizedType);
    const knownModels = getKnownModelsForTask(taskType);

    if (knownModels.has(requestedModel)) {
        return requestedModel;
    }

    return fallbackModelName;
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
    resolveModelName,
    parseJsonResponse
};
