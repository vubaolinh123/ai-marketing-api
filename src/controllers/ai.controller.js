/**
 * AI Controller
 * Handles AI-related API endpoints
 */

const geminiService = require('../services/gemini');
const { getModelForTask } = require('../services/gemini/modelConfig.service');
const Article = require('../models/Article');
const { AISettings } = require('../models');

/**
 * Generate article with AI
 * POST /api/ai/generate-article
 */
exports.generateArticle = async (req, res) => {
    try {
        const { mode, topic, purpose, description, wordCount = 250, imageUrl, imageUrls, useBrandSettings } = req.body;

        // Validate required fields
        if (!topic || !purpose || !description) {
            return res.status(400).json({
                success: false,
                message: 'Vui lòng điền đầy đủ thông tin: topic, purpose, description'
            });
        }

        // Fetch brand context if enabled
        let brandContext = null;
        if (useBrandSettings) {
            const aiSettings = await AISettings.findOne({ userId: req.user._id });
            brandContext = geminiService.buildBrandContext(aiSettings);
        }

        // Get user's selected model
        const textModel = await getModelForTask('text', req.user._id);

        let result;

        const normalizedImageUrls = Array.isArray(imageUrls) && imageUrls.length > 0
            ? imageUrls.filter(Boolean)
            : imageUrl
                ? [imageUrl]
                : [];

        if (mode === 'manual' && normalizedImageUrls.length > 0) {
            // Manual mode with uploaded image
            result = await geminiService.generateArticleWithImage({
                topic,
                purpose,
                description,
                wordCount,
                imagePath: normalizedImageUrls[0],
                brandContext,
                modelName: textModel
            });
            // Keep the user's uploaded image
            result.imageUrl = normalizedImageUrls[0];
            result.imageUrls = normalizedImageUrls;
        } else if (mode === 'ai_image' && normalizedImageUrls.length > 0) {
            // AI Image mode with pre-generated image
            result = await geminiService.generateArticleWithImage({
                topic,
                purpose,
                description,
                wordCount,
                imagePath: normalizedImageUrls[0],
                brandContext,
                modelName: textModel
            });
            // Keep pre-generated image URL
            result.imageUrl = normalizedImageUrls[0];
            result.imageUrls = normalizedImageUrls;
        } else if (mode === 'ai_image') {
            // AI Image mode - fallback to old behavior
            result = await geminiService.generateArticleWithAIImage({
                topic,
                purpose,
                description,
                wordCount,
                brandContext,
                modelName: textModel
            });
        } else {
            // Default text-only generation
            result = await geminiService.generateArticleContent({
                topic,
                purpose,
                description,
                wordCount,
                brandContext,
                modelName: textModel
            });
        }

        res.status(200).json({
            success: true,
            message: 'Tạo bài viết thành công',
            data: {
                title: result.title,
                content: result.content,
                hashtags: result.hashtags || [],
                imageUrl: result.imageUrl || null,
                imageUrls: result.imageUrls || (result.imageUrl ? [result.imageUrl] : []),
                imagePrompt: result.imagePrompt || null
            }
        });
    } catch (error) {
        console.error('Generate article error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Lỗi khi tạo bài viết với AI'
        });
    }
};

/**
 * Generate and save article
 * POST /api/ai/generate-and-save
 */
exports.generateAndSaveArticle = async (req, res) => {
    try {
        const { mode, topic, purpose, description, wordCount = 250, imageUrl, imageUrls, useBrandSettings } = req.body;

        // Validate required fields
        if (!topic || !purpose || !description) {
            return res.status(400).json({
                success: false,
                message: 'Vui lòng điền đầy đủ thông tin'
            });
        }

        // Fetch brand context if enabled
        let brandContext = null;
        if (useBrandSettings) {
            const aiSettings = await AISettings.findOne({ userId: req.user._id });
            brandContext = geminiService.buildBrandContext(aiSettings);
        }

        // Get user's selected model
        const textModel = await getModelForTask('text', req.user._id);

        let result;

        const normalizedImageUrls = Array.isArray(imageUrls) && imageUrls.length > 0
            ? imageUrls.filter(Boolean)
            : imageUrl
                ? [imageUrl]
                : [];

        if (mode === 'manual' && normalizedImageUrls.length > 0) {
            result = await geminiService.generateArticleWithImage({
                topic,
                purpose,
                description,
                wordCount,
                imagePath: normalizedImageUrls[0],
                brandContext,
                modelName: textModel
            });
            result.imageUrl = normalizedImageUrls[0];
            result.imageUrls = normalizedImageUrls;
        } else if (mode === 'ai_image' && normalizedImageUrls.length > 0) {
            result = await geminiService.generateArticleWithImage({
                topic,
                purpose,
                description,
                wordCount,
                imagePath: normalizedImageUrls[0],
                brandContext,
                modelName: textModel
            });
            result.imageUrl = normalizedImageUrls[0];
            result.imageUrls = normalizedImageUrls;
        } else if (mode === 'ai_image') {
            result = await geminiService.generateArticleWithAIImage({
                topic,
                purpose,
                description,
                wordCount,
                brandContext,
                modelName: textModel
            });
        } else {
            result = await geminiService.generateArticleContent({
                topic,
                purpose,
                description,
                wordCount,
                brandContext,
                modelName: textModel
            });
        }

        // Save to database
        const article = await Article.create({
            userId: req.user._id,
            title: result.title,
            content: result.content,
            topic,
            purpose,
            imageUrl: result.imageUrl || null,
            imageUrls: result.imageUrls || (result.imageUrl ? [result.imageUrl] : []),
            hashtags: result.hashtags || [],
            status: 'draft'
        });

        res.status(201).json({
            success: true,
            message: 'Tạo và lưu bài viết thành công',
            data: {
                article,
                generated: {
                    title: result.title,
                    content: result.content,
                    hashtags: result.hashtags,
                    imageUrl: result.imageUrl,
                    imageUrls: result.imageUrls || (result.imageUrl ? [result.imageUrl] : []),
                    imagePrompt: result.imagePrompt
                }
            }
        });
    } catch (error) {
        console.error('Generate and save article error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Lỗi khi tạo bài viết'
        });
    }
};

/**
 * Analyze image with AI
 * POST /api/ai/analyze-image
 */
exports.analyzeImage = async (req, res) => {
    try {
        const { imagePath, imageUrl, customPrompt } = req.body;

        // Validate - need either imagePath or imageUrl
        if (!imagePath && !imageUrl) {
            return res.status(400).json({
                success: false,
                message: 'Vui lòng cung cấp imagePath (đường dẫn file) hoặc imageUrl (link ảnh)'
            });
        }
        // Get user's selected model for vision
        const visionModel = await getModelForTask('vision', req.user._id);

        let analysis;

        if (imageUrl) {
            // Analyze from URL
            analysis = await geminiService.analyzeImageUrl(imageUrl, customPrompt, visionModel);
        } else {
            // Analyze from local file
            analysis = await geminiService.analyzeImage(imagePath, customPrompt, visionModel);
        }

        res.status(200).json({
            success: true,
            message: 'Phân tích ảnh thành công',
            data: {
                analysis,
                source: imageUrl || imagePath
            }
        });
    } catch (error) {
        console.error('Analyze image error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Lỗi khi phân tích ảnh'
        });
    }
};
