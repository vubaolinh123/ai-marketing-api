const mongoose = require('mongoose');

const articleSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    title: {
        type: String,
        required: [true, 'Tiêu đề bài viết là bắt buộc'],
        trim: true,
        maxlength: [500, 'Tiêu đề không được quá 500 ký tự']
    },
    content: {
        type: String,
        required: [true, 'Nội dung bài viết là bắt buộc']
    },
    topic: {
        type: String,
        required: [true, 'Chủ đề là bắt buộc'],
        enum: ['marketing', 'social_media', 'ecommerce', 'branding', 'content', 'seo', 'product', 'event']
    },
    purpose: {
        type: String,
        required: [true, 'Mục đích là bắt buộc'],
        enum: ['introduce', 'sell', 'share_knowledge']
    },
    imageUrl: {
        type: String,
        trim: true
    },
    hashtags: [{
        type: String,
        trim: true
    }],
    status: {
        type: String,
        enum: ['draft', 'published'],
        default: 'draft'
    }
}, {
    timestamps: true
});

// Index for faster queries by user
articleSchema.index({ userId: 1, createdAt: -1 });

// Virtual for formatted date
articleSchema.virtual('formattedDate').get(function() {
    return this.createdAt.toLocaleDateString('vi-VN');
});

// Ensure virtuals are included in JSON
articleSchema.set('toJSON', { virtuals: true });
articleSchema.set('toObject', { virtuals: true });

const Article = mongoose.model('Article', articleSchema);

module.exports = Article;
