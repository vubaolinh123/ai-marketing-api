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
const { normalizeDisplayInfo, logError } = require('../utils');

const PROCESSING_STALE_MS = Number(process.env.PRODUCT_IMAGE_STALE_MS || 10 * 60 * 1000);
const HEARTBEAT_INTERVAL_MS = Number(process.env.PRODUCT_IMAGE_HEARTBEAT_MS || 5000);

function isProcessingStale(image, now = new Date()) {
    if (!image || image.status !== 'processing') return false;

    const heartbeat = image.processingHeartbeatAt || image.updatedAt || image.processingStartedAt;
    if (!heartbeat) return false;

    return now.getTime() - new Date(heartbeat).getTime() > PROCESSING_STALE_MS;
}

function startHeartbeatTimer(imageId) {
    if (!imageId) return null;

    const timer = setInterval(() => {
        ProductImage.updateOne(
            { _id: imageId, status: 'processing' },
            { $set: { processingHeartbeatAt: new Date() } }
        ).catch(() => {});
    }, HEARTBEAT_INTERVAL_MS);

    if (typeof timer.unref === 'function') {
        timer.unref();
    }

    return timer;
}

async function refreshAndResolveStaleProcessing(items) {
    if (!Array.isArray(items) || items.length === 0) {
        return items;
    }

    const now = new Date();
    let changed = false;

    for (const item of items) {
        if (!isProcessingStale(item, now)) continue;

        item.status = 'failed';
        if (!item.errorMessage) {
            item.errorMessage = 'Tiến trình tạo ảnh đã quá thời gian xử lý, vui lòng thử lại hoặc xóa.';
        }
        item.processingCompletedAt = now;
        item.processingHeartbeatAt = now;
        await item.save();
        changed = true;
    }

    if (!changed) return items;

    const ids = items.map((item) => item._id);
    return ProductImage.find({ _id: { $in: ids } })
        .sort({ createdAt: -1 });
}

function decorateProcessingState(image, now = new Date()) {
    if (!image) return image;

    const plain = typeof image.toObject === 'function' ? image.toObject() : { ...image };
    const stale = isProcessingStale(image, now);
    const lastHeartbeat = image.processingHeartbeatAt || image.updatedAt || image.processingStartedAt || null;

    plain.isProcessingStale = stale;
    plain.isLikelyRunning = plain.status === 'processing' && !stale;
    plain.processingLastHeartbeatAt = lastHeartbeat;

    return plain;
}

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
        const normalizedDisplayInfo = normalizeDisplayInfo(displayInfo);
        const processingStartedAt = new Date();

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
            displayInfo: normalizedDisplayInfo,
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
            status: 'processing',
            processingStartedAt,
            processingHeartbeatAt: processingStartedAt,
            processingCompletedAt: null
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

        let heartbeatTimer = null;
        try {
            heartbeatTimer = startHeartbeatTimer(productImage._id);
            // Generate the image
            const generatedImages = await geminiService.productImageService.generateProductWithBackground({
                originalImagePath,
                backgroundType: normalizedBackgroundType,
                cameraAngles: normalizedAngles,
                customBackground: normalizedCustomBackground,
                usagePurpose,
                displayInfo: normalizedDisplayInfo,
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
            productImage.processingHeartbeatAt = new Date();
            productImage.processingCompletedAt = new Date();
            await productImage.save();

            res.status(201).json({
                success: true,
                message: 'Tạo ảnh AI thành công',
                data: decorateProcessingState(productImage)
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
            productImage.processingHeartbeatAt = new Date();
            productImage.processingCompletedAt = new Date();
            await productImage.save();

            throw genError;
        } finally {
            if (heartbeatTimer) {
                clearInterval(heartbeatTimer);
            }
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
        logError('Generate product image error', {
            endpoint: 'POST /api/product-images/generate',
            error
        });
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

        const normalizedDisplayInfo = normalizeDisplayInfo(originalImage.displayInfo);
        if (originalImage.displayInfo !== normalizedDisplayInfo) {
            originalImage.displayInfo = normalizedDisplayInfo;
        }

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
        originalImage.processingStartedAt = new Date();
        originalImage.processingHeartbeatAt = new Date();
        originalImage.processingCompletedAt = null;
        const normalizedAngles = normalizeCameraAngles(originalImage.cameraAngles);
        originalImage.cameraAngles = normalizedAngles;
        originalImage.generatedImages = normalizedAngles.map((angle) => ({
            angle,
            imageUrl: '',
            status: 'processing',
            errorMessage: ''
        }));
        await originalImage.save();

        let heartbeatTimer = null;
        try {
            heartbeatTimer = startHeartbeatTimer(originalImage._id);
            // Regenerate the image
            const generatedImages = await geminiService.productImageService.generateProductWithBackground({
                originalImagePath,
                backgroundType: originalImage.backgroundType,
                cameraAngles: normalizedAngles,
                customBackground: normalizedCustomBackground,
                usagePurpose: originalImage.usagePurpose,
                displayInfo: normalizedDisplayInfo,
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
            originalImage.processingHeartbeatAt = new Date();
            originalImage.processingCompletedAt = new Date();
            await originalImage.save();

            res.status(200).json({
                success: true,
                message: 'Tạo lại ảnh AI thành công',
                data: decorateProcessingState(originalImage)
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
            originalImage.processingHeartbeatAt = new Date();
            originalImage.processingCompletedAt = new Date();
            await originalImage.save();

            throw genError;
        } finally {
            if (heartbeatTimer) {
                clearInterval(heartbeatTimer);
            }
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
        logError('Regenerate product image error', {
            endpoint: 'POST /api/product-images/:id/regenerate',
            error
        });
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

        const [imagesRaw, total] = await Promise.all([
            ProductImage.find(query)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(parseInt(limit)),
            ProductImage.countDocuments(query)
        ]);

        const images = await refreshAndResolveStaleProcessing(imagesRaw);
        const now = new Date();
        const responseItems = images.map((item) => decorateProcessingState(item, now));

        res.status(200).json({
            success: true,
            data: responseItems,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        logError('Get product images error', {
            endpoint: 'GET /api/product-images',
            error
        });
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

        if (image && isProcessingStale(image)) {
            image.status = 'failed';
            if (!image.errorMessage) {
                image.errorMessage = 'Tiến trình tạo ảnh đã quá thời gian xử lý, vui lòng thử lại hoặc xóa.';
            }
            image.processingHeartbeatAt = new Date();
            image.processingCompletedAt = new Date();
            await image.save();
        }

        const safeImage = await ProductImage.findOne({
            _id: id,
            userId: req.user._id
        });

        res.status(200).json({
            success: true,
            data: decorateProcessingState(safeImage)
        });
    } catch (error) {
        logError('Get product image error', {
            endpoint: 'GET /api/product-images/:id',
            error
        });
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
        logError('Delete product image error', {
            endpoint: 'DELETE /api/product-images/:id',
            error
        });
        res.status(500).json({
            success: false,
            message: 'Lỗi khi xóa ảnh'
        });
    }
};
