const mongoose = require('mongoose');

const refreshTokenSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    tokenHash: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    family: {
        type: String,
        required: true,
        index: true
    },
    isRememberMe: {
        type: Boolean,
        default: false
    },
    expiresAt: {
        type: Date,
        default: null,
        index: true
    },
    revokedAt: {
        type: Date,
        default: null,
        index: true
    },
    replacedByTokenHash: {
        type: String,
        default: ''
    },
    createdByIp: {
        type: String,
        default: ''
    },
    lastUsedAt: {
        type: Date,
        default: null
    },
    lastUsedIp: {
        type: String,
        default: ''
    },
    userAgent: {
        type: String,
        default: ''
    }
}, {
    timestamps: true
});

refreshTokenSchema.index({ userId: 1, family: 1 });

module.exports = mongoose.model('RefreshToken', refreshTokenSchema);
