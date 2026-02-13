/**
 * Product Image Controller
 * Handles CRUD operations for product images with AI generation
 */

const ProductImage = require('../models/ProductImage');
const AISettings = require('../models/AISettings');
const geminiService = require('../services/gemini');
const { getModelForTask } = require('../services/gemini/modelConfig.service');
const { deleteFilesFromPaths } = require('../utils/fileCleanup');
const { logPromptDebug } = require('../utils/promptDebug');

function normalizeCameraAngles(cameraAngles) {
    const supportedAngles = ['wide', 'medium', 'closeup', 'topdown', 'detail'];
    const inputAngles = Array.isArray(cameraAngles) && cameraAngles.length > 0
        ? cameraAngles
        : ['wide'];

    const normalized = [];
    for (const angle of inputAngles) {
        if (!supportedAngles.includes(angle)) continue;
        if (!normalized.includes(angle)) {
            normalized.push(angle);
        }
    }

    return normalized.length > 0 ? normalized : ['wide'];
}

function mapStatusFromGeneratedImages(generatedImages) {
    const hasSuccess = generatedImages.some(item => item.status === 'completed' && item.imageUrl);
    const hasFailure = generatedImages.some(item => item.status === 'failed');

    if (!hasSuccess) return 'failed';
    if (hasFailure) return 'failed';
    return 'completed';
}

/**
 * Generate product image with AI
 * POST /api/product-images/generate
 */
exports.generateProductImage = async (req, res) => {
    try {
        const {
            originalImageUrl,
            backgroundType,
            cameraAngles,
            customBackground,
            usagePurpose,
            displayInfo,
            adIntensity,
            typographyGuidance,
            targetAudience,
            visualStyle,
            realismPriority,
            useLogo,
            logoPosition,
            outputSize,
            additionalNotes,
            useBrandSettings,
            title
        } = req.body;

        logPromptDebug({
            tool: 'image',
            step: 'received-input',
            data: {
                originalImageUrl,
                backgroundType,
                cameraAngles,
                customBackground,
                usagePurpose,
                displayInfo,
                adIntensity,
                typographyGuidance,
                targetAudience,
                visualStyle,
                realismPriority,
                useLogo,
                logoPosition,
                outputSize,
                additionalNotes,
                useBrandSettings,
                title
            }
        });

        // Validate required fields
        if (!originalImageUrl) {
            return res.status(400).json({
                success: false,
                message: 'Vui lòng upload ảnh sản phẩm'
            });
        }

        const normalizedOriginalImageUrl = typeof originalImageUrl === 'string' ? originalImageUrl.trim() : '';
        if (!normalizedOriginalImageUrl.startsWith('/uploads/')) {
            return res.status(400).json({
                success: false,
                message: 'originalImageUrl phải là đường dẫn upload cục bộ, ví dụ: /uploads/...'
            });
        }

        const normalizedBackgroundType = backgroundType || 'studio';
        const normalizedCustomBackground = typeof customBackground === 'string' ? customBackground.trim() : '';
        if (normalizedBackgroundType === 'custom' && !normalizedCustomBackground) {
            return res.status(400).json({
                success: false,
                message: 'customBackground là bắt buộc khi backgroundType là custom'
            });
        }

        const normalizedAngles = normalizeCameraAngles(cameraAngles);

        // Get user's selected model for image generation
        const imageGenModel = await getModelForTask('imageGen', req.user._id);

        // Create initial record with processing status
        const productImage = await ProductImage.create({
            userId: req.user._id,
            title: title || 'Ảnh sản phẩm ' + new Date().toLocaleDateString('vi-VN'),
            originalImageUrl: normalizedOriginalImageUrl,
            backgroundType: normalizedBackgroundType,
            cameraAngles: normalizedAngles,
            generatedImages: normalizedAngles.map((angle) => ({
                angle,
                imageUrl: '',
                status: 'processing',
                errorMessage: ''
            })),
            customBackground: normalizedCustomBackground,
            usagePurpose: usagePurpose || '',
            displayInfo: displayInfo || '',
            adIntensity: adIntensity || '',
            typographyGuidance: typographyGuidance || '',
            targetAudience: targetAudience || '',
            visualStyle: visualStyle || '',
            realismPriority: realismPriority || '',
            modelUsed: imageGenModel || '',
            useLogo: useLogo !== false,
            logoPosition: logoPosition || 'bottom-right',
            outputSize: outputSize || '1:1',
            additionalNotes: additionalNotes || '',
            usedBrandSettings: !!useBrandSettings,
            status: 'processing'
        });

        // Fetch brand context and logo if enabled
        let brandContext = null;
        let logoUrl = null;
        
        if (useBrandSettings) {
            const aiSettings = await AISettings.findOne({ userId: req.user._id });
            if (aiSettings) {
                try {
                    brandContext = await geminiService.buildRichBrandContext(aiSettings);
                } catch (error) {
                    brandContext = geminiService.buildBrandContext(aiSettings);
                }
                logoUrl = aiSettings.logo?.logoUrl;
            }
        }

        logPromptDebug({
            tool: 'image',
            step: 'brand-context',
            data: {
                enabled: !!useBrandSettings,
                available: !!brandContext,
                preview: brandContext,
                hasLogoUrl: !!logoUrl
            }
        });

        // Get full path to original image
        const originalImagePath = geminiService.productImageService.getFilePathFromUrl(normalizedOriginalImageUrl);

        try {
            // Generate the image
            const generatedImages = await geminiService.productImageService.generateProductWithBackground({
                originalImagePath,
                backgroundType: normalizedBackgroundType,
                cameraAngles: normalizedAngles,
                customBackground: normalizedCustomBackground,
                usagePurpose,
                displayInfo,
                adIntensity,
                typographyGuidance,
                targetAudience,
                visualStyle,
                realismPriority,
                useLogo: useLogo !== false,
                logoPosition: logoPosition || 'bottom-right',
                logoUrl,
                outputSize: outputSize || '1:1',
                additionalNotes,
                brandContext,
                modelName: imageGenModel
            });

            logPromptDebug({
                tool: 'image',
                step: 'ai-response',
                data: {
                    ok: true,
                    total: generatedImages.length,
                    successCount: generatedImages.filter((item) => item.status === 'completed').length,
                    generatedImages
                }
            });

            // Update record with result
            productImage.generatedImages = generatedImages;
            productImage.generatedImageUrl = generatedImages.find(item => item.status === 'completed' && item.imageUrl)?.imageUrl || '';
            productImage.status = mapStatusFromGeneratedImages(generatedImages);
            const firstError = generatedImages.find(item => item.status === 'failed' && item.errorMessage)?.errorMessage;
            productImage.errorMessage = firstError || '';
            await productImage.save();

            res.status(201).json({
                success: true,
                message: 'Tạo ảnh AI thành công',
                data: productImage
            });
        } catch (genError) {
            logPromptDebug({
                tool: 'image',
                step: 'ai-response-error',
                data: {
                    message: genError?.message,
                    stack: genError?.stack,
                    phase: 'generateProductImage'
                }
            });
            // Update record with error
            productImage.status = 'failed';
            productImage.errorMessage = genError.message;
            await productImage.save();

            throw genError;
        }
    } catch (error) {
        logPromptDebug({
            tool: 'image',
            step: 'ai-response-error',
            data: {
                message: error?.message,
                stack: error?.stack,
                phase: 'generateProductImage-controller'
            }
        });
        console.error('Generate product image error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Lỗi khi tạo ảnh AI'
        });
    }
};

/**
 * Regenerate product image with same input
 * POST /api/product-images/:id/regenerate
 */
exports.regenerateProductImage = async (req, res) => {
    try {
        const { id } = req.params;

        logPromptDebug({
            tool: 'image',
            step: 'received-input',
            data: {
                operation: 'regenerateProductImage',
                id
            }
        });

        // Find the original record (must be owned by user)
        const originalImage = await ProductImage.findOne({
            _id: id,
            userId: req.user._id
        });

        if (!originalImage) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy ảnh'
            });
        }

        // Fetch brand context and logo if original used brand settings
        let brandContext = null;
        let logoUrl = null;
        
        if (originalImage.usedBrandSettings) {
            const aiSettings = await AISettings.findOne({ userId: req.user._id });
            if (aiSettings) {
                try {
                    brandContext = await geminiService.buildRichBrandContext(aiSettings);
                } catch (error) {
                    brandContext = geminiService.buildBrandContext(aiSettings);
                }
                logoUrl = aiSettings.logo?.logoUrl;
            }
        }

        logPromptDebug({
            tool: 'image',
            step: 'brand-context',
            data: {
                enabled: !!originalImage.usedBrandSettings,
                available: !!brandContext,
                preview: brandContext,
                hasLogoUrl: !!logoUrl
            }
        });

        // Get full path to original image
        const normalizedOriginalImageUrl = typeof originalImage.originalImageUrl === 'string'
            ? originalImage.originalImageUrl.trim()
            : '';

        if (!normalizedOriginalImageUrl.startsWith('/uploads/')) {
            return res.status(400).json({
                success: false,
                message: 'Ảnh gốc không hợp lệ: originalImageUrl phải là đường dẫn cục bộ /uploads/...'
            });
        }

        const normalizedCustomBackground = typeof originalImage.customBackground === 'string'
            ? originalImage.customBackground.trim()
            : '';
        if (originalImage.backgroundType === 'custom' && !normalizedCustomBackground) {
            return res.status(400).json({
                success: false,
                message: 'Dữ liệu cũ không hợp lệ: customBackground là bắt buộc khi backgroundType là custom'
            });
        }

        const originalImagePath = geminiService.productImageService.getFilePathFromUrl(normalizedOriginalImageUrl);

        const imageGenModel = originalImage.modelUsed || await getModelForTask('imageGen', req.user._id);
        if (!originalImage.modelUsed && imageGenModel) {
            originalImage.modelUsed = imageGenModel;
        }

        // Delete old generated image(s) before regenerating (to save storage)
        const oldGeneratedUrls = [
            originalImage.generatedImageUrl,
            ...(Array.isArray(originalImage.generatedImages)
                ? originalImage.generatedImages.map((item) => item.imageUrl)
                : [])
        ].filter(Boolean);

        if (oldGeneratedUrls.length > 0) {
            const { deleteFilesFromPaths } = require('../utils/fileCleanup');
            await deleteFilesFromPaths(oldGeneratedUrls);
        }

        // Update status to processing
        originalImage.status = 'processing';
        originalImage.errorMessage = '';
        const normalizedAngles = normalizeCameraAngles(originalImage.cameraAngles);
        originalImage.cameraAngles = normalizedAngles;
        originalImage.generatedImages = normalizedAngles.map((angle) => ({
            angle,
            imageUrl: '',
            status: 'processing',
            errorMessage: ''
        }));
        await originalImage.save();

        try {
            // Regenerate the image
            const generatedImages = await geminiService.productImageService.generateProductWithBackground({
                originalImagePath,
                backgroundType: originalImage.backgroundType,
                cameraAngles: normalizedAngles,
                customBackground: normalizedCustomBackground,
                usagePurpose: originalImage.usagePurpose,
                displayInfo: originalImage.displayInfo,
                adIntensity: originalImage.adIntensity,
                typographyGuidance: originalImage.typographyGuidance,
                targetAudience: originalImage.targetAudience,
                visualStyle: originalImage.visualStyle,
                realismPriority: originalImage.realismPriority,
                useLogo: originalImage.useLogo,
                logoPosition: originalImage.logoPosition,
                logoUrl,
                outputSize: originalImage.outputSize,
                additionalNotes: originalImage.additionalNotes,
                brandContext,
                modelName: imageGenModel
            });

            logPromptDebug({
                tool: 'image',
                step: 'ai-response',
                data: {
                    ok: true,
                    operation: 'regenerateProductImage',
                    total: generatedImages.length,
                    successCount: generatedImages.filter((item) => item.status === 'completed').length,
                    generatedImages
                }
            });

            // Update record with new result
            originalImage.generatedImages = generatedImages;
            originalImage.generatedImageUrl = generatedImages.find(item => item.status === 'completed' && item.imageUrl)?.imageUrl || '';
            originalImage.status = mapStatusFromGeneratedImages(generatedImages);
            const firstError = generatedImages.find(item => item.status === 'failed' && item.errorMessage)?.errorMessage;
            originalImage.errorMessage = firstError || '';
            await originalImage.save();

            res.status(200).json({
                success: true,
                message: 'Tạo lại ảnh AI thành công',
                data: originalImage
            });
        } catch (genError) {
            logPromptDebug({
                tool: 'image',
                step: 'ai-response-error',
                data: {
                    operation: 'regenerateProductImage',
                    message: genError?.message,
                    stack: genError?.stack
                }
            });
            originalImage.status = 'failed';
            originalImage.errorMessage = genError.message;
            await originalImage.save();

            throw genError;
        }
    } catch (error) {
        logPromptDebug({
            tool: 'image',
            step: 'ai-response-error',
            data: {
                operation: 'regenerateProductImage-controller',
                message: error?.message,
                stack: error?.stack
            }
        });
        console.error('Regenerate product image error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Lỗi khi tạo lại ảnh AI'
        });
    }
};

/**
 * Get all product images for current user
 * GET /api/product-images
 */
exports.getAllProductImages = async (req, res) => {
    try {
        const { page = 1, limit = 12, search = '', backgroundType = '', status = '' } = req.query;
        const skip = (page - 1) * limit;

        // Build query - only user's own images
        const query = { userId: req.user._id };
        
        if (search) {
            query.title = { $regex: search, $options: 'i' };
        }

        if (backgroundType) {
            query.backgroundType = backgroundType;
        }

        if (status) {
            query.status = status;
        }

        const [images, total] = await Promise.all([
            ProductImage.find(query)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(parseInt(limit))
                .select('-errorMessage'),
            ProductImage.countDocuments(query)
        ]);

        res.status(200).json({
            success: true,
            data: images,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('Get product images error:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi khi lấy danh sách ảnh'
        });
    }
};

/**
 * Get single product image by ID
 * GET /api/product-images/:id
 */
exports.getProductImageById = async (req, res) => {
    try {
        const { id } = req.params;

        // Only get image if owned by current user
        const image = await ProductImage.findOne({
            _id: id,
            userId: req.user._id
        });

        if (!image) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy ảnh'
            });
        }

        res.status(200).json({
            success: true,
            data: image
        });
    } catch (error) {
        console.error('Get product image error:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi khi lấy thông tin ảnh'
        });
    }
};

/**
 * Delete product image
 * DELETE /api/product-images/:id
 */
exports.deleteProductImage = async (req, res) => {
    try {
        const { id } = req.params;

        // Only delete if owned by current user
        const image = await ProductImage.findOneAndDelete({
            _id: id,
            userId: req.user._id
        });

        if (!image) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy ảnh'
            });
        }

        // Delete associated image files from disk
        const imagePaths = [
            image.originalImageUrl,
            image.generatedImageUrl,
            ...(Array.isArray(image.generatedImages)
                ? image.generatedImages.map((item) => item.imageUrl)
                : [])
        ].filter(Boolean);
        const fileResult = await deleteFilesFromPaths(imagePaths);

        res.status(200).json({
            success: true,
            message: fileResult.filesNotFound.length > 0
                ? `Xóa ảnh thành công (không tìm thấy ${fileResult.filesNotFound.length} file để xóa)`
                : 'Xóa ảnh thành công',
            filesDeleted: fileResult.filesDeleted,
            filesNotFound: fileResult.filesNotFound
        });
    } catch (error) {
        console.error('Delete product image error:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi khi xóa ảnh'
        });
    }
};
