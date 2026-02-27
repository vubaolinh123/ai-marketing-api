const mongoose = require('mongoose');

const TOKEN_TOOLS = ['article', 'image', 'video', 'marketing', 'unknown'];

const TokenUsageFeatureDailySchema = new mongoose.Schema({
    dateKey: {
        type: String,
        required: true,
        index: true
    },
    weekKey: {
        type: String,
        required: true,
        index: true
    },
    monthKey: {
        type: String,
        required: true,
        index: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    actorUserId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    isImpersonating: {
        type: Boolean,
        default: false
    },
    tool: {
        type: String,
        enum: TOKEN_TOOLS,
        required: true,
        index: true
    },
    featureKey: {
        type: String,
        required: true,
        index: true
    },
    provider: {
        type: String,
        default: 'google-gemini'
    },
    model: {
        type: String,
        default: ''
    },
    requestCount: {
        type: Number,
        default: 0
    },
    promptTokens: {
        type: Number,
        default: 0
    },
    completionTokens: {
        type: Number,
        default: 0
    },
    totalTokens: {
        type: Number,
        default: 0
    },
    supplementalTokens: {
        type: Number,
        default: 0
    },
    thoughtTokens: {
        type: Number,
        default: 0
    },
    cachedTokens: {
        type: Number,
        default: 0
    },
    toolUseTokens: {
        type: Number,
        default: 0
    },
    otherKnownTokens: {
        type: Number,
        default: 0
    },
    explainedSupplementalTokens: {
        type: Number,
        default: 0
    },
    unexplainedTokens: {
        type: Number,
        default: 0
    },
    firstRequestAt: {
        type: Date,
        default: null
    },
    lastRequestAt: {
        type: Date,
        default: null
    }
}, {
    timestamps: true
});

TokenUsageFeatureDailySchema.index(
    { dateKey: 1, userId: 1, featureKey: 1, provider: 1 },
    { unique: true }
);
TokenUsageFeatureDailySchema.index({ userId: 1, dateKey: 1 });
TokenUsageFeatureDailySchema.index({ featureKey: 1, dateKey: 1 });

module.exports = mongoose.model('TokenUsageFeatureDaily', TokenUsageFeatureDailySchema);
