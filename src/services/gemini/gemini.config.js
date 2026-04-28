/**
 * Gemini AI Configuration
 * Centralized configuration for all Gemini AI services
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { MODEL_RECOMMENDATIONS, DEFAULT_MODELS } = require('./modelConfig.service');
const {
    isDetailedApiLogEnabled,
    logWarn,
    logError,
    logOutboundRequest,
    logOutboundResponse
} = require('../../utils/logger');
const { recordGeminiTokenUsage } = require('../tokenUsage.service');

// Validate API key
if (!process.env.API_KEY_GEMINI) {
    logWarn('API_KEY_GEMINI not found in environment variables');
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
function buildGeminiInputMeta(payload) {
    if (typeof payload === 'string') {
        return {
            inputType: 'text',
            promptChars: payload.length
        };
    }

    if (Array.isArray(payload)) {
        const textChars = payload
            .filter((item) => typeof item === 'string')
            .reduce((total, item) => total + item.length, 0);

        const hasInlineData = payload.some((item) => !!item?.inlineData);

        return {
            inputType: 'multipart',
            partCount: payload.length,
            textChars,
            hasInlineData
        };
    }

    if (payload && typeof payload === 'object') {
        return {
            inputType: 'object',
            keys: Object.keys(payload).join(',')
        };
    }

    return {
        inputType: typeof payload
    };
}

function estimatePromptTokens(payload) {
    const estimateFromChars = (chars) => {
        if (!Number.isFinite(chars) || chars <= 0) return 0;
        return Math.max(1, Math.ceil(chars / 4));
    };

    if (typeof payload === 'string') {
        return estimateFromChars(payload.length);
    }

    if (Array.isArray(payload)) {
        const textChars = payload
            .filter((item) => typeof item === 'string')
            .reduce((total, item) => total + item.length, 0);

        return estimateFromChars(textChars);
    }

    return 0;
}

function getErrorCode(error) {
    if (!error) return 500;
    return Number(error.status || error.statusCode || 500);
}

function createLoggedModel(model, { modelName, type }) {
    if (!model || typeof model.generateContent !== 'function') {
        return model;
    }

    return new Proxy(model, {
        get(target, prop, receiver) {
            const raw = Reflect.get(target, prop, receiver);

            if (prop !== 'generateContent' || typeof raw !== 'function') {
                return typeof raw === 'function' ? raw.bind(target) : raw;
            }

            return async function loggedGenerateContent(...args) {
                const inputPayload = args[0];
                const operationUrl = `gemini://${modelName}/generateContent`;
                const startedAt = process.hrtime.bigint();
                const requestMeta = {
                    provider: 'google-gemini',
                    model: modelName,
                    modelType: normalizeModelType(type),
                    operation: 'generateContent',
                    ...buildGeminiInputMeta(inputPayload)
                };
                const debugEnabled = isDetailedApiLogEnabled();

                if (debugEnabled) {
                    logOutboundRequest({
                        method: 'POST',
                        url: operationUrl,
                        ...requestMeta
                    });
                }

                try {
                    const response = await raw.apply(target, args);
                    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

                    recordGeminiTokenUsage({
                        modelName,
                        operation: 'generateContent',
                        responsePayload: response,
                        fallbackPromptTokens: estimatePromptTokens(inputPayload),
                        fallbackSource: 'prompt-char-estimate-v1'
                    }).catch((tokenLogError) => {
                        logWarn('Gemini token usage logging skipped due to error', {
                            modelName,
                            message: tokenLogError?.message
                        });
                    });

                    if (debugEnabled) {
                        logOutboundResponse({
                            method: 'POST',
                            url: operationUrl,
                            status: 200,
                            durationMs,
                            ...requestMeta
                        });
                    }

                    return response;
                } catch (error) {
                    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
                    const status = getErrorCode(error);

                    logOutboundResponse({
                        method: 'POST',
                        url: operationUrl,
                        status,
                        durationMs,
                        error: error?.message || 'Gemini request failed',
                        ...requestMeta
                    });

                    // Tag rate-limit errors so callers can distinguish them
                    const isRateLimit = status === 429 ||
                        String(error?.message || '').includes('429') ||
                        /Too Many Requests/i.test(error?.message || '') ||
                        /Resource exhausted/i.test(error?.message || '');

                    if (isRateLimit) {
                        error.isRateLimit = true;
                    }

                    // Centralized 429 backoff: 1 quick retry (1.5s) before re-throwing.
                    // Kept to 1 attempt only — the service layer (productImage.service.js)
                    // handles deeper retries with its own backoff. Two layers compounding
                    // would waste too much time (up to 9s total per failed call).
                    // Base delay configurable via GEMINI_RETRY_BASE_DELAY_MS (default 1500ms).
                    if (isRateLimit) {
                        const rlDelay = Math.max(500, Number(process.env.GEMINI_RETRY_BASE_DELAY_MS) || 1500);
                        logWarn(`[gemini.config] 429 rate-limit detected, backing off ${rlDelay}ms before single retry`, {
                            modelName,
                            rlDelay
                        });
                        await new Promise((resolve) => setTimeout(resolve, rlDelay));
                        try {
                            const retryResponse = await raw.apply(target, args);
                            return retryResponse;
                        } catch (retryError) {
                            const retryStatus = getErrorCode(retryError);
                            const retryIsRateLimit = retryStatus === 429 ||
                                String(retryError?.message || '').includes('429') ||
                                /Too Many Requests/i.test(retryError?.message || '') ||
                                /Resource exhausted/i.test(retryError?.message || '');
                            if (retryIsRateLimit) {
                                retryError.isRateLimit = true;
                            }
                            throw retryError;
                        }
                    }

                    throw error;
                }
            };
        }
    });
}

function getModel(type, customModelName = null, modelOptions = {}) {
    const modelName = resolveModelName(type, customModelName);

    try {
        const model = genAI.getGenerativeModel({ model: modelName, ...modelOptions });
        return createLoggedModel(model, { modelName, type });
    } catch (error) {
        const fallbackModelName = MODELS[normalizeModelType(type)] || MODELS.TEXT;
        logError('Gemini model init failed, fallback to default model', {
            modelName,
            fallbackModelName,
            error
        });

        const fallbackModel = genAI.getGenerativeModel({ model: fallbackModelName, ...modelOptions });
        return createLoggedModel(fallbackModel, { modelName: fallbackModelName, type });
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
            logError('JSON parse error', { error });
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
