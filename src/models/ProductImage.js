/**
 * ProductImage Model
 * Stores AI-generated product images with background and logo overlay
 */

const mongoose = require('mongoose');

const CAMERA_ANGLES = ['wide', 'medium', 'closeup', 'topdown', 'detail'];

const GeneratedImageSchema = new mongoose.Schema({
    angle: {
        type: String,
        enum: CAMERA_ANGLES,
        required: true
    },
    imageUrl: {
        type: String,
        default: ''
    },
    status: {
        type: String,
        enum: ['processing', 'completed', 'failed'],
        default: 'processing'
    },
    errorMessage: {
        type: String,
        default: ''
    }
}, { _id: false });

const ProductImageSchema = new mongoose.Schema({
    // Owner - only this user can access
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    
    // Title for the image
    title: {
        type: String,
        trim: true,
        default: 'Ảnh sản phẩm'
    },
    
    // Original uploaded image
    originalImageUrl: {
        type: String,
        required: true
    },
    
    // AI-generated result image
    generatedImageUrl: {
        type: String,
        default: ''
    },

    // Multi-angle generation settings and results
    cameraAngles: {
        type: [{
            type: String,
            enum: CAMERA_ANGLES
        }],
        default: ['wide']
    },
    generatedImages: {
        type: [GeneratedImageSchema],
        default: []
    },
    
    // Background settings
    backgroundType: {
        type: String,
        enum: ['studio', 'outdoor', 'lifestyle', 'minimal', 'luxury', 'kitchen', 'restaurant', 'action', 'custom'],
        default: 'studio'
    },
    customBackground: {
        type: String,
        trim: true,
        default: ''
    },

    // Creative guidance (optional)
    usagePurpose: {
        type: String,
        trim: true,
        default: ''
    },
    displayInfo: {
        type: String,
        trim: true,
        default: ''
    },
    adIntensity: {
        type: String,
        trim: true,
        default: ''
    },
    typographyGuidance: {
        type: String,
        trim: true,
        default: ''
    },
    targetAudience: {
        type: String,
        trim: true,
        default: ''
    },
    visualStyle: {
        type: String,
        trim: true,
        default: ''
    },
    realismPriority: {
        type: String,
        trim: true,
        default: ''
    },

    // Model used for this generation
    modelUsed: {
        type: String,
        trim: true,
        default: ''
    },
    
    // Logo settings
    useLogo: {
        type: Boolean,
        default: true
    },
    logoPosition: {
        type: String,
        enum: ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center', 'none'],
        default: 'bottom-right'
    },
    
    // Output settings
    outputSize: {
        type: String,
        enum: ['1:1', '4:5', '9:16', '16:9', '3:4'],
        default: '1:1'
    },
    
    // Additional requirements
    additionalNotes: {
        type: String,
        trim: true,
        default: ''
    },
    
    // Whether brand settings were used
    usedBrandSettings: {
        type: Boolean,
        default: false
    },
    
    // Processing status
    status: {
        type: String,
        enum: ['processing', 'completed', 'failed'],
        default: 'processing'
    },
    
    // Error message if failed
    errorMessage: {
        type: String,
        default: ''
    }
}, {
    timestamps: true
});

// Compound index for efficient querying by user and date
ProductImageSchema.index({ userId: 1, createdAt: -1 });

// Ensure virtuals are included in JSON
ProductImageSchema.set('toJSON', { virtuals: true });
ProductImageSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('ProductImage', ProductImageSchema);
