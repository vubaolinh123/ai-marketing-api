/**
 * AI Controller
 * Handles AI-related API endpoints
 */

const geminiService = require('../services/gemini');
const { getModelForTask } = require('../services/gemini/modelConfig.service');
const Article = require('../models/Article');
const { AISettings } = require('../models');
const { logPromptDebug } = require('../utils/promptDebug');

/**
 * Generate article with AI
 * POST /api/ai/generate-article
 */
exports.generateArticle = async (req, res) => {
    try {
        const {
            mode,
            topic,
            purpose,
            description,
            wordCount = 250,
            imageUrl,
            imageUrls,
            useBrandSettings,
            writingStyle,
            storytellingDepth,
            baseTitle,
            baseContent,
            regenerateInstruction
        } = req.body;

        logPromptDebug({
            tool: 'article',
            step: 'received-input',
            data: {
                mode,
                topic,
                purpose,
                wordCount,
                useBrandSettings,
                writingStyle,
                storytellingDepth,
                hasDescription: !!description,
                hasBaseContent: !!baseContent,
                imageUrl,
                imageUrls
            }
        });

        // Validate required fields
        if (!topic || !purpose || (!description && !baseContent)) {
            return res.status(400).json({
                success: false,
                message: 'Vui lòng điền đầy đủ thông tin: topic, purpose và (description hoặc baseContent)'
            });
        }

        // Fetch brand context if enabled
        let brandContext = null;
        if (useBrandSettings) {
            const aiSettings = await AISettings.findOne({ userId: req.user._id });
            try {
                brandContext = await geminiService.buildRichBrandContext(aiSettings);
            } catch (error) {
                brandContext = geminiService.buildBrandContext(aiSettings);
            }
        }

        logPromptDebug({
            tool: 'article',
            step: 'brand-context',
            data: {
                enabled: !!useBrandSettings,
                available: !!brandContext,
                preview: brandContext
            }
        });

        // Get user's selected model
        const textModel = await getModelForTask('text', req.user._id);

        let result;

        const normalizedImageUrls = Array.isArray(imageUrls) && imageUrls.length > 0
            ? imageUrls.filter(Boolean)
            : imageUrl
                ? [imageUrl]
                : [];

        logPromptDebug({
            tool: 'article',
            step: 'prompt-built',
            data: {
                mode,
                selectedModel: textModel,
                topic,
                purpose,
                wordCount,
                writingStyle,
                storytellingDepth,
                normalizedImageUrls,
                hasRegenerateInstruction: !!regenerateInstruction
            }
        });

        if (mode === 'manual' && normalizedImageUrls.length > 0) {
            // Manual mode with uploaded image
            result = await geminiService.generateArticleWithImage({
                topic,
                purpose,
                description,
                wordCount,
                imagePath: normalizedImageUrls[0],
                brandContext,
                writingStyle,
                storytellingDepth,
                baseTitle,
                baseContent,
                regenerateInstruction,
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
                writingStyle,
                storytellingDepth,
                baseTitle,
                baseContent,
                regenerateInstruction,
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
                writingStyle,
                storytellingDepth,
                baseTitle,
                baseContent,
                regenerateInstruction,
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
                writingStyle,
                storytellingDepth,
                baseTitle,
                baseContent,
                regenerateInstruction,
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

        logPromptDebug({
            tool: 'article',
            step: 'ai-response',
            data: {
                ok: true,
                title: result?.title,
                hasContent: !!result?.content,
                hashtagsCount: Array.isArray(result?.hashtags) ? result.hashtags.length : 0,
                imageUrl: result?.imageUrl || null
            }
        });
    } catch (error) {
        logPromptDebug({
            tool: 'article',
            step: 'ai-response-error',
            data: {
                message: error?.message,
                stack: error?.stack
            }
        });
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
        const {
            mode,
            topic,
            purpose,
            description,
            wordCount = 250,
            imageUrl,
            imageUrls,
            useBrandSettings,
            writingStyle,
            storytellingDepth,
            baseTitle,
            baseContent,
            regenerateInstruction
        } = req.body;

        logPromptDebug({
            tool: 'article',
            step: 'received-input',
            data: {
                mode,
                topic,
                purpose,
                wordCount,
                useBrandSettings,
                writingStyle,
                storytellingDepth,
                hasDescription: !!description,
                hasBaseContent: !!baseContent,
                imageUrl,
                imageUrls,
                saveMode: true
            }
        });

        // Validate required fields
        if (!topic || !purpose || (!description && !baseContent)) {
            return res.status(400).json({
                success: false,
                message: 'Vui lòng điền đầy đủ thông tin: topic, purpose và (description hoặc baseContent)'
            });
        }

        // Fetch brand context if enabled
        let brandContext = null;
        if (useBrandSettings) {
            const aiSettings = await AISettings.findOne({ userId: req.user._id });
            try {
                brandContext = await geminiService.buildRichBrandContext(aiSettings);
            } catch (error) {
                brandContext = geminiService.buildBrandContext(aiSettings);
            }
        }

        logPromptDebug({
            tool: 'article',
            step: 'brand-context',
            data: {
                enabled: !!useBrandSettings,
                available: !!brandContext,
                preview: brandContext
            }
        });

        // Get user's selected model
        const textModel = await getModelForTask('text', req.user._id);

        let result;

        const normalizedImageUrls = Array.isArray(imageUrls) && imageUrls.length > 0
            ? imageUrls.filter(Boolean)
            : imageUrl
                ? [imageUrl]
                : [];

        logPromptDebug({
            tool: 'article',
            step: 'prompt-built',
            data: {
                mode,
                selectedModel: textModel,
                topic,
                purpose,
                wordCount,
                writingStyle,
                storytellingDepth,
                normalizedImageUrls,
                hasRegenerateInstruction: !!regenerateInstruction,
                saveMode: true
            }
        });

        if (mode === 'manual' && normalizedImageUrls.length > 0) {
            result = await geminiService.generateArticleWithImage({
                topic,
                purpose,
                description,
                wordCount,
                imagePath: normalizedImageUrls[0],
                brandContext,
                writingStyle,
                storytellingDepth,
                baseTitle,
                baseContent,
                regenerateInstruction,
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
                writingStyle,
                storytellingDepth,
                baseTitle,
                baseContent,
                regenerateInstruction,
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
                writingStyle,
                storytellingDepth,
                baseTitle,
                baseContent,
                regenerateInstruction,
                modelName: textModel
            });
        } else {
            result = await geminiService.generateArticleContent({
                topic,
                purpose,
                description,
                wordCount,
                brandContext,
                writingStyle,
                storytellingDepth,
                baseTitle,
                baseContent,
                regenerateInstruction,
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

        logPromptDebug({
            tool: 'article',
            step: 'ai-response',
            data: {
                ok: true,
                articleId: article?._id,
                title: result?.title,
                hashtagsCount: Array.isArray(result?.hashtags) ? result.hashtags.length : 0,
                imageUrl: result?.imageUrl || null
            }
        });
    } catch (error) {
        logPromptDebug({
            tool: 'article',
            step: 'ai-response-error',
            data: {
                message: error?.message,
                stack: error?.stack,
                saveMode: true
            }
        });
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

        logPromptDebug({
            tool: 'article',
            step: 'received-input',
            data: {
                mode: 'analyze-image',
                imagePath,
                imageUrl,
                customPrompt
            }
        });

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

        logPromptDebug({
            tool: 'article',
            step: 'prompt-built',
            data: {
                mode: 'analyze-image',
                modelName: visionModel,
                hasCustomPrompt: !!customPrompt
            }
        });

        logPromptDebug({
            tool: 'article',
            step: 'ai-response',
            data: {
                mode: 'analyze-image',
                modelName: visionModel,
                analysisPreview: analysis
            }
        });

        res.status(200).json({
            success: true,
            message: 'Phân tích ảnh thành công',
            data: {
                analysis,
                source: imageUrl || imagePath
            }
        });
    } catch (error) {
        logPromptDebug({
            tool: 'article',
            step: 'ai-response-error',
            data: {
                mode: 'analyze-image',
                message: error?.message,
                stack: error?.stack
            }
        });
        console.error('Analyze image error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Lỗi khi phân tích ảnh'
        });
    }
};
