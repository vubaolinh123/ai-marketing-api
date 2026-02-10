/**
 * Product Image Controller
 * Handles CRUD operations for product images with AI generation
 */

const ProductImage = require('../models/ProductImage');
const AISettings = require('../models/AISettings');
const geminiService = require('../services/gemini');
const path = require('path');
const { deleteFilesFromPaths } = require('../utils/fileCleanup');

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
            useLogo,
            logoPosition,
            outputSize,
            additionalNotes,
            useBrandSettings,
            title
        } = req.body;

        // Validate required fields
        if (!originalImageUrl) {
            return res.status(400).json({
                success: false,
                message: 'Vui lòng upload ảnh sản phẩm'
            });
        }

        const normalizedAngles = normalizeCameraAngles(cameraAngles);

        // Create initial record with processing status
        const productImage = await ProductImage.create({
            userId: req.user._id,
            title: title || 'Ảnh sản phẩm ' + new Date().toLocaleDateString('vi-VN'),
            originalImageUrl,
            backgroundType: backgroundType || 'studio',
            cameraAngles: normalizedAngles,
            generatedImages: normalizedAngles.map((angle) => ({
                angle,
                imageUrl: '',
                status: 'processing',
                errorMessage: ''
            })),
            customBackground: customBackground || '',
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
                brandContext = geminiService.buildBrandContext(aiSettings);
                logoUrl = aiSettings.logo?.logoUrl;
            }
        }

        // Get full path to original image
        const originalImagePath = geminiService.productImageService.getFilePathFromUrl(originalImageUrl);

        try {
            // Generate the image
            const generatedImages = await geminiService.productImageService.generateProductWithBackground({
                originalImagePath,
                backgroundType: backgroundType || 'studio',
                cameraAngles: normalizedAngles,
                customBackground,
                useLogo: useLogo !== false,
                logoPosition: logoPosition || 'bottom-right',
                logoUrl,
                outputSize: outputSize || '1:1',
                additionalNotes,
                brandContext
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
            // Update record with error
            productImage.status = 'failed';
            productImage.errorMessage = genError.message;
            await productImage.save();

            throw genError;
        }
    } catch (error) {
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
                brandContext = geminiService.buildBrandContext(aiSettings);
                logoUrl = aiSettings.logo?.logoUrl;
            }
        }

        // Get full path to original image
        const originalImagePath = geminiService.productImageService.getFilePathFromUrl(originalImage.originalImageUrl);

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
            console.log('Deleted old generated images:', oldGeneratedUrls.length);
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
                customBackground: originalImage.customBackground,
                useLogo: originalImage.useLogo,
                logoPosition: originalImage.logoPosition,
                logoUrl,
                outputSize: originalImage.outputSize,
                additionalNotes: originalImage.additionalNotes,
                brandContext
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
            originalImage.status = 'failed';
            originalImage.errorMessage = genError.message;
            await originalImage.save();

            throw genError;
        }
    } catch (error) {
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
