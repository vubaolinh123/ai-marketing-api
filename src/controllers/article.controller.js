const Article = require('../models/Article');
const AISettings = require('../models/AISettings');
const { resolveArticlePurpose } = require('../utils/articlePurpose');
const { deleteFileFromPath } = require('../utils/fileCleanup');
const { publishPagePost } = require('../services/facebook.service');

function escapeRegex(input = '') {
    return String(input).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildFacebookPostMessage(article = {}) {
    const title = String(article.title || '').trim();
    const content = String(article.content || '').trim();
    const hashtags = Array.isArray(article.hashtags)
        ? article.hashtags
            .map((tag) => String(tag || '').trim())
            .filter(Boolean)
            .map((tag) => (tag.startsWith('#') ? tag : `#${tag}`))
        : [];

    const parts = [title, content, hashtags.join(' ')].filter(Boolean);
    const message = parts.join('\n\n').trim();

    // Giới hạn an toàn dưới mức tối đa của Facebook
    return message.length > 60000 ? `${message.slice(0, 59997)}...` : message;
}

/**
 * Create a new article
 * POST /api/articles
 */
exports.createArticle = async (req, res) => {
    try {
        const { title, content, topic, purpose, imageUrl, imageUrls, hashtags, status } = req.body;
        const purposeEnumValues = Article.schema.path('purpose')?.enumValues || [];
        const { storageValue: purposeForStorage } = resolveArticlePurpose(purpose, purposeEnumValues);

        const normalizedImageUrls = Array.isArray(imageUrls) && imageUrls.length > 0
            ? imageUrls.filter(Boolean)
            : imageUrl
                ? [imageUrl]
                : [];

        const article = await Article.create({
            userId: req.user._id,
            title,
            content,
            topic,
            purpose: purposeForStorage,
            imageUrl: imageUrl || normalizedImageUrls[0],
            imageUrls: normalizedImageUrls,
            hashtags: hashtags || [],
            status: status || 'draft'
        });

        res.status(201).json({
            success: true,
            message: 'Tạo bài viết thành công',
            data: article
        });
    } catch (error) {
        console.error('Create article error:', error);
        res.status(400).json({
            success: false,
            message: error.message || 'Không thể tạo bài viết'
        });
    }
};

/**
 * Get all articles for current user
 * GET /api/articles
 */
exports.getArticles = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        // Filter options
        const filter = { userId: req.user._id };
        
        if (req.query.topic) {
            filter.topic = req.query.topic;
        }
        if (req.query.purpose) {
            filter.purpose = {
                $regex: escapeRegex(req.query.purpose),
                $options: 'i'
            };
        }
        if (req.query.status) {
            filter.status = req.query.status;
        }
        if (req.query.search) {
            filter.$or = [
                { title: { $regex: req.query.search, $options: 'i' } },
                { content: { $regex: req.query.search, $options: 'i' } }
            ];
        }

        const [articles, total] = await Promise.all([
            Article.find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Article.countDocuments(filter)
        ]);

        res.json({
            success: true,
            data: {
                articles,
                pagination: {
                    page,
                    limit,
                    total,
                    totalPages: Math.ceil(total / limit)
                }
            }
        });
    } catch (error) {
        console.error('Get articles error:', error);
        res.status(500).json({
            success: false,
            message: 'Không thể lấy danh sách bài viết'
        });
    }
};

/**
 * Get single article by ID
 * GET /api/articles/:id
 */
exports.getArticle = async (req, res) => {
    try {
        const article = await Article.findOne({
            _id: req.params.id,
            userId: req.user._id
        });

        if (!article) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy bài viết'
            });
        }

        res.json({
            success: true,
            data: article
        });
    } catch (error) {
        console.error('Get article error:', error);
        res.status(500).json({
            success: false,
            message: 'Không thể lấy bài viết'
        });
    }
};

/**
 * Update article
 * PUT /api/articles/:id
 */
exports.updateArticle = async (req, res) => {
    try {
        const { title, content, topic, purpose, imageUrl, imageUrls, hashtags, status } = req.body;
        const purposeEnumValues = Article.schema.path('purpose')?.enumValues || [];

        const updateData = {};

        if (Object.prototype.hasOwnProperty.call(req.body, 'title')) {
            updateData.title = title;
        }
        if (Object.prototype.hasOwnProperty.call(req.body, 'content')) {
            updateData.content = content;
        }
        if (Object.prototype.hasOwnProperty.call(req.body, 'topic')) {
            updateData.topic = topic;
        }
        if (Object.prototype.hasOwnProperty.call(req.body, 'purpose')) {
            updateData.purpose = resolveArticlePurpose(purpose, purposeEnumValues).storageValue;
        }
        if (Object.prototype.hasOwnProperty.call(req.body, 'hashtags')) {
            updateData.hashtags = hashtags;
        }
        if (Object.prototype.hasOwnProperty.call(req.body, 'status')) {
            updateData.status = status;
        }

        // Image fields use partial-update semantics:
        // - omit => preserve existing values
        // - provide imageUrls => update imageUrls and sync imageUrl to first item
        // - provide imageUrl only => update imageUrl and keep imageUrls unless explicitly provided
        if (Object.prototype.hasOwnProperty.call(req.body, 'imageUrls')) {
            const normalizedImageUrls = Array.isArray(imageUrls) ? imageUrls.filter(Boolean) : [];
            updateData.imageUrls = normalizedImageUrls;
            updateData.imageUrl = Object.prototype.hasOwnProperty.call(req.body, 'imageUrl')
                ? imageUrl
                : normalizedImageUrls[0] || null;
        } else if (Object.prototype.hasOwnProperty.call(req.body, 'imageUrl')) {
            updateData.imageUrl = imageUrl;
        }

        const article = await Article.findOneAndUpdate(
            { _id: req.params.id, userId: req.user._id },
            updateData,
            { new: true, runValidators: true }
        );

        if (!article) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy bài viết'
            });
        }

        res.json({
            success: true,
            message: 'Cập nhật bài viết thành công',
            data: article
        });
    } catch (error) {
        console.error('Update article error:', error);
        res.status(400).json({
            success: false,
            message: error.message || 'Không thể cập nhật bài viết'
        });
    }
};

/**
 * Delete article
 * DELETE /api/articles/:id
 */
exports.deleteArticle = async (req, res) => {
    try {
        const article = await Article.findOneAndDelete({
            _id: req.params.id,
            userId: req.user._id
        });

        if (!article) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy bài viết'
            });
        }

        // Delete associated image file(s) from disk
        let filesNotFound = [];
        const imagePaths = Array.from(new Set([
            article.imageUrl,
            ...(Array.isArray(article.imageUrls) ? article.imageUrls : [])
        ].filter(Boolean)));

        for (const imagePath of imagePaths) {
            const result = await deleteFileFromPath(imagePath);
            if (result.notFound) {
                filesNotFound.push(imagePath);
            }
        }

        res.json({
            success: true,
            message: filesNotFound.length > 0 
                ? 'Xóa bài viết thành công (không tìm thấy ảnh để xóa)' 
                : 'Xóa bài viết thành công',
            filesDeleted: Math.max(0, imagePaths.length - filesNotFound.length),
            filesNotFound
        });
    } catch (error) {
        console.error('Delete article error:', error);
        res.status(500).json({
            success: false,
            message: 'Không thể xóa bài viết'
        });
    }
};

/**
 * Post article to Facebook Page
 * POST /api/articles/:id/post-facebook
 */
exports.postArticleToFacebook = async (req, res) => {
    try {
        const article = await Article.findOne({
            _id: req.params.id,
            userId: req.user._id
        });

        if (!article) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy bài viết'
            });
        }

        const settings = await AISettings.findOne({ userId: req.user._id }).lean();
        const facebookToken = String(settings?.facebook?.facebookToken || '').trim();
        const facebookPageId = String(settings?.facebook?.facebookPageId || '').trim();
        const facebookPageName = String(settings?.facebook?.facebookPageName || '').trim();

        if (!facebookToken) {
            return res.status(400).json({
                success: false,
                message: 'Bạn chưa cấu hình token Facebook trong AI Settings.'
            });
        }

        if (!facebookPageId) {
            return res.status(400).json({
                success: false,
                message: 'Bạn chưa cấu hình Page ID Facebook trong AI Settings.'
            });
        }

        const message = buildFacebookPostMessage(article);
        if (!message) {
            return res.status(400).json({
                success: false,
                message: 'Bài viết không có nội dung để đăng Facebook.'
            });
        }

        const publishResult = await publishPagePost({
            pageId: facebookPageId,
            pageToken: facebookToken,
            message
        });

        return res.status(200).json({
            success: true,
            message: 'Đăng bài lên Facebook thành công.',
            data: {
                postId: publishResult.postId,
                pageId: publishResult.pageId,
                pageName: facebookPageName || null
            }
        });
    } catch (error) {
        console.error('Post article to Facebook error:', error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || 'Không thể đăng bài lên Facebook.'
        });
    }
};
