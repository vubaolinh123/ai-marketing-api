const mongoose = require('mongoose');

// Sub-schema cho từng bài đăng trong marketing plan
const MarketingPostSchema = new mongoose.Schema({
    date: { 
        type: Date, 
        required: true 
    },
    time: { 
        type: String, 
        required: true,
        trim: true
    },
    topic: { 
        type: String, 
        required: true,
        trim: true
    },
    channel: { 
        type: String, 
        required: true,
        enum: ['facebook', 'instagram', 'tiktok', 'website', 'zalo']
    },
    status: { 
        type: String, 
        enum: ['scheduled', 'draft', 'published'], 
        default: 'scheduled' 
    },
    contentIdea: { 
        type: String,
        trim: true
    },
    purpose: { 
        type: String,
        enum: ['engagement', 'sales', 'awareness', 'traffic', 'leads'],
        default: 'engagement'
    },
    postType: { 
        type: String, 
        enum: ['image', 'video', 'story', 'blog', 'reel'], 
        default: 'image' 
    },
    suggestedHashtags: { 
        type: [String], 
        default: [] 
    }
}, { _id: true });

// Main Marketing Plan Schema
const MarketingPlanSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    
    // Input fields (stored for reference)
    campaignName: { 
        type: String, 
        required: true,
        trim: true
    },
    startDate: { 
        type: Date, 
        required: true 
    },
    endDate: { 
        type: Date, 
        required: true 
    },
    postsPerWeek: { 
        type: Number, 
        default: 5,
        min: 1,
        max: 14
    },
    postTimes: { 
        type: [String], 
        default: ['18:00'] 
    },
    topics: { 
        type: [String], 
        required: true 
    },
    goals: { 
        type: [String], 
        default: [] 
    },
    channels: { 
        type: [String], 
        required: true 
    },
    notes: { 
        type: String, 
        default: '',
        trim: true
    },

    // Campaign-thinking inputs (optional)
    priorityProductService: {
        type: String,
        trim: true,
        default: ''
    },
    monthlyFocus: {
        type: String,
        trim: true,
        default: ''
    },
    promotions: {
        type: String,
        trim: true,
        default: ''
    },
    customerJourneyStage: {
        type: String,
        trim: true,
        default: ''
    },
    targetSegment: {
        type: String,
        trim: true,
        default: ''
    },
    strategySuggestion: {
        type: mongoose.Schema.Types.Mixed,
        default: ''
    },
    
    // AI Settings toggle
    useBrandSettings: { 
        type: Boolean, 
        default: false 
    },
    
    // Output - AI generated posts
    posts: { 
        type: [MarketingPostSchema], 
        default: [] 
    },
    totalPosts: { 
        type: Number, 
        default: 0 
    },
    
    // Plan status
    status: { 
        type: String, 
        enum: ['processing', 'failed', 'active', 'completed', 'draft'], 
        default: 'active' 
    }
}, { 
    timestamps: true 
});

// Index để tìm kiếm nhanh
MarketingPlanSchema.index({ userId: 1, createdAt: -1 });
MarketingPlanSchema.index({ status: 1 });

module.exports = mongoose.model('MarketingPlan', MarketingPlanSchema);
