const mongoose = require('mongoose');

// Sub-schema cho Resource Links
const ResourceLinkSchema = new mongoose.Schema({
    label: {
        type: String,
        trim: true
    },
    url: {
        type: String,
        trim: true
    }
}, { _id: false });

// Sub-schema cho Context Descriptions
const ContextDescriptionSchema = new mongoose.Schema({
    context: {
        type: String,
        trim: true
    },
    description: {
        type: String,
        trim: true
    }
}, { _id: false });

// Main AI Settings Schema
const AISettingsSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true // Mỗi user chỉ có 1 settings
    },
    logo: {
        brandName: {
            type: String,
            trim: true,
            default: ''
        },
        logoUrl: {
            type: String,
            default: ''
        },
        brandIdentity: {
            type: String,
            trim: true,
            default: ''
        },
        resourceLinks: {
            type: [ResourceLinkSchema],
            default: []
        }
    },
    colors: {
        primaryColor: {
            type: String,
            default: '#F59E0B'
        },
        backgroundColor: {
            type: String,
            default: '#1a1a1a'
        },
        accentColor: {
            type: String,
            default: '#0891b2'
        }
    },
    language: {
        keywords: {
            type: [String],
            default: []
        },
        customerTerm: {
            type: String,
            trim: true,
            default: ''
        },
        brandPronoun: {
            type: String,
            trim: true,
            default: ''
        }
    },
    tone: {
        overallTone: {
            type: [String],
            default: []
        },
        contextDescriptions: {
            type: [ContextDescriptionSchema],
            default: []
        }
    },
    product: {
        productGroups: {
            type: [String],
            default: []
        },
        strengths: {
            type: String,
            trim: true,
            default: ''
        },
        suitableFor: {
            type: [String],
            default: []
        }
    },
    facebook: {
        facebookToken: {
            type: String,
            trim: true,
            default: ''
        }
    },
    aiModels: {
        textModel: {
            type: String,
            default: 'gemini-2.5-flash'
        },
        visionModel: {
            type: String,
            default: 'gemini-2.0-flash'
        },
        imageGenModel: {
            type: String,
            default: 'gemini-2.0-flash-exp-image-generation'
        }
    }
}, {
    timestamps: true
});

// Index để tìm kiếm nhanh theo userId
AISettingsSchema.index({ userId: 1 });

module.exports = mongoose.model('AISettings', AISettingsSchema);
