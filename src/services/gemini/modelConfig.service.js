/**
 * Gemini Model Configuration Service
 * Handles model selection, recommendations, and user preferences
 */

const { AISettings } = require('../../models');

// Model recommendations với token costs và benchmarks
const MODEL_RECOMMENDATIONS = {
    text: [
        {
            modelId: 'gemini-2.5-flash',
            displayName: 'Gemini 2.5 Flash',
            badge: 'stable',
            badgeIcon: '✅',
            gpqa: '~80%',
            speed: 'Fast',
            inputCost: '$0.075/1M',
            outputCost: '$0.3/1M',
            context: '1M tokens',
            description: 'Tốc độ nhanh, chi phí thấp, phù hợp đa số tác vụ'
        },
        {
            modelId: 'gemini-2.5-pro',
            displayName: 'Gemini 2.5 Pro',
            badge: 'premium',
            badgeIcon: '⭐',
            gpqa: '88.3%',
            speed: 'Medium',
            inputCost: '$1.25/1M',
            outputCost: '$5/1M',
            context: '1M tokens',
            description: 'Độ chính xác cao cho nội dung chuyên sâu'
        },
        {
            modelId: 'gemini-2.0-flash',
            displayName: 'Gemini 2.0 Flash',
            badge: null,
            badgeIcon: null,
            gpqa: '~75%',
            speed: 'Fast',
            inputCost: '$0.075/1M',
            outputCost: '$0.3/1M',
            context: '1M tokens',
            description: 'Phiên bản ổn định, tương thích tốt'
        }
    ],
    vision: [
        {
            modelId: 'gemini-2.0-flash',
            displayName: 'Gemini 2.0 Flash',
            badge: 'stable',
            badgeIcon: '✅',
            mmmuPro: '~75%',
            tokensPerImage: '~258',
            inputCost: '$0.075/1M',
            description: 'Phân tích ảnh nhanh với chi phí thấp'
        },
        {
            modelId: 'gemini-2.5-flash',
            displayName: 'Gemini 2.5 Flash',
            badge: 'hot',
            badgeIcon: '🔥',
            mmmuPro: '~80%',
            tokensPerImage: '~258',
            inputCost: '$0.075/1M',
            description: 'Cân bằng tốc độ và độ chính xác'
        },
        {
            modelId: 'gemini-2.5-pro',
            displayName: 'Gemini 2.5 Pro',
            badge: 'premium',
            badgeIcon: '⭐',
            mmmuPro: '~85%',
            tokensPerImage: '~258',
            inputCost: '$1.25/1M',
            description: 'Độ chính xác cao nhất cho vision tasks'
        }
    ],
    imageGen: [
        {
            modelId: 'gemini-2.5-flash-image',
            displayName: 'Gemini 2.5 Flash Image',
            badge: 'hot',
            badgeIcon: '🔥',
            quality: 'High',
            tokensPerImage: '~1000',
            description: 'Tạo ảnh chất lượng cao, tốc độ nhanh'
        },
        {
            modelId: 'gemini-3-pro-image-preview',
            displayName: 'Gemini 3 Pro Image Preview',
            badge: 'premium',
            badgeIcon: '⭐',
            quality: 'Highest',
            tokensPerImage: '~1000',
            description: 'Mô hình preview chất lượng cao cho hình ảnh'
        },
        {
            modelId: 'gemini-2.0-flash-exp-image-generation',
            displayName: 'Gemini 2.0 Flash Image Gen',
            badge: 'stable',
            badgeIcon: '✅',
            quality: 'Medium',
            tokensPerImage: '~1000',
            description: 'Tạo ảnh ổn định, experimental'
        }
    ]
};

// Default models cho mỗi task type
const DEFAULT_MODELS = {
    text: 'gemini-2.5-flash',
    vision: 'gemini-2.5-flash',
    imageGen: 'gemini-3-pro-image-preview'
};

/**
 * Get model for specific task based on user settings
 * @param {string} taskType - 'text' | 'vision' | 'imageGen'
 * @param {string} userId - User's ObjectId
 * @returns {Promise<string>} Model name to use
 */
async function getModelForTask(taskType, userId) {
    try {
        if (!userId) {
            return sanitizeModelForTask(taskType);
        }

        const settings = await AISettings.findOne({ userId });
        
        if (!settings || !settings.aiModels) {
            return sanitizeModelForTask(taskType);
        }

        const modelMap = {
            text: settings.aiModels.textModel,
            vision: settings.aiModels.visionModel,
            imageGen: settings.aiModels.imageGenModel
        };

        return sanitizeModelForTask(taskType, modelMap[taskType]);
    } catch (error) {
        console.error('Error getting model for task:', error);
        return sanitizeModelForTask(taskType);
    }
}

/**
 * Get model recommendations data
 * @returns {Object} Recommendations with token costs
 */
function getModelRecommendations() {
    return MODEL_RECOMMENDATIONS;
}

/**
 * Get default models
 * @returns {Object} Default model for each task type
 */
function getDefaultModels() {
    return DEFAULT_MODELS;
}

/**
 * Validate if a model ID is valid for a task type
 * @param {string} taskType - Task type
 * @param {string} modelId - Model ID to validate
 * @returns {boolean} Whether the model is valid
 */
function isValidModel(taskType, modelId) {
    const recommendations = MODEL_RECOMMENDATIONS[taskType] || [];
    return recommendations.some(m => m.modelId === modelId);
}

/**
 * Sanitize model id for task type, fallback to default if invalid
 * @param {string} taskType - Task type
 * @param {string} modelId - Incoming model ID
 * @returns {string} Safe model ID
 */
function sanitizeModelForTask(taskType, modelId) {
    const safeTaskType = MODEL_RECOMMENDATIONS[taskType] ? taskType : 'text';
    const fallbackModel = DEFAULT_MODELS[safeTaskType] || DEFAULT_MODELS.text;

    if (typeof modelId !== 'string' || !modelId.trim()) {
        return fallbackModel;
    }

    const trimmedModelId = modelId.trim();
    return isValidModel(safeTaskType, trimmedModelId) ? trimmedModelId : fallbackModel;
}

module.exports = {
    getModelForTask,
    getModelRecommendations,
    getDefaultModels,
    isValidModel,
    sanitizeModelForTask,
    MODEL_RECOMMENDATIONS,
    DEFAULT_MODELS
};
