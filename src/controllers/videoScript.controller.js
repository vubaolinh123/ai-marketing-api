/**
 * Video Script Controller
 * Handles CRUD operations for video scripts with AI generation
 */

const VideoScript = require('../models/VideoScript');
const AISettings = require('../models/AISettings');
const geminiService = require('../services/gemini');
const { exportVideoScriptToExcel } = require('../services/excel');

/**
 * Generate video script with AI
 * POST /api/video-scripts/generate
 */
exports.generateScript = async (req, res) => {
    try {
        const { 
            title, 
            duration, 
            sceneCount,
            size, 
            hasVoiceOver, 
            otherRequirements,
            ideaMode,
            customIdea,
            useBrandSettings 
        } = req.body;

        // Validate required fields
        if (!title) {
            return res.status(400).json({
                success: false,
                message: 'Vui lòng nhập tiêu đề/chủ đề video'
            });
        }

        // Fetch brand context if enabled
        let brandContext = null;
        if (useBrandSettings) {
            const aiSettings = await AISettings.findOne({ userId: req.user._id });
            brandContext = geminiService.buildBrandContext(aiSettings);
        }

        // Generate script with AI
        const result = await geminiService.generateVideoScript({
            input: {
                title,
                duration,
                sceneCount: sceneCount || 6,
                size,
                hasVoiceOver,
                otherRequirements,
                ideaMode,
                customIdea
            },
            brandContext
        });

        // Save to database
        const videoScript = await VideoScript.create({
            userId: req.user._id,
            title,
            duration,
            requestedSceneCount: sceneCount || 6,
            size,
            hasVoiceOver,
            summary: result.summary,
            scenes: result.scenes,
            otherRequirements,
            ideaMode,
            status: 'completed'
        });

        res.status(201).json({
            success: true,
            message: 'Tạo kịch bản thành công',
            data: videoScript
        });
    } catch (error) {
        console.error('Generate script error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Lỗi khi tạo kịch bản'
        });
    }
};

/**
 * Generate video idea with AI
 * POST /api/video-scripts/generate-idea
 */
exports.generateIdea = async (req, res) => {
    try {
        const { title, duration, sceneCount, useBrandSettings } = req.body;

        // Validate required fields
        if (!title) {
            return res.status(400).json({
                success: false,
                message: 'Vui lòng nhập tiêu đề/chủ đề video trước khi tạo ý tưởng'
            });
        }

        // Brand settings is required for idea generation
        if (!useBrandSettings) {
            return res.status(400).json({
                success: false,
                message: 'Vui lòng bật "Sử dụng thông tin thương hiệu" để sử dụng tính năng AI tạo ý tưởng'
            });
        }

        // Fetch brand context
        const aiSettings = await AISettings.findOne({ userId: req.user._id });
        const brandContext = geminiService.buildBrandContext(aiSettings);

        // Generate idea with parameters
        const idea = await geminiService.generateRandomIdea({
            title,
            duration,
            sceneCount,
            brandContext
        });

        res.status(200).json({
            success: true,
            data: idea
        });
    } catch (error) {
        console.error('Generate idea error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Lỗi khi tạo ý tưởng'
        });
    }
};

/**
 * Get all scripts for current user
 * GET /api/video-scripts
 */
exports.getAllScripts = async (req, res) => {
    try {
        const { page = 1, limit = 10, search = '', duration = '', size = '' } = req.query;
        const skip = (page - 1) * limit;

        // Build query - only user's own scripts
        const query = { userId: req.user._id };
        
        if (search) {
            query.title = { $regex: search, $options: 'i' };
        }

        if (duration) {
            query.duration = duration;
        }

        if (size) {
            query.size = size;
        }

        const [scripts, total] = await Promise.all([
            VideoScript.find(query)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(parseInt(limit))
                .select('-scenes'),  // Exclude scenes for list
            VideoScript.countDocuments(query)
        ]);

        res.status(200).json({
            success: true,
            data: scripts,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('Get scripts error:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi khi lấy danh sách kịch bản'
        });
    }
};

/**
 * Get single script by ID
 * GET /api/video-scripts/:id
 */
exports.getScriptById = async (req, res) => {
    try {
        const { id } = req.params;

        // Only get script if owned by current user
        const script = await VideoScript.findOne({
            _id: id,
            userId: req.user._id
        });

        if (!script) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy kịch bản'
            });
        }

        res.status(200).json({
            success: true,
            data: script
        });
    } catch (error) {
        console.error('Get script error:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi khi lấy kịch bản'
        });
    }
};

/**
 * Update script
 * PUT /api/video-scripts/:id
 */
exports.updateScript = async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        // Only update if owned by current user
        const script = await VideoScript.findOneAndUpdate(
            { _id: id, userId: req.user._id },
            { $set: updates },
            { new: true, runValidators: true }
        );

        if (!script) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy kịch bản'
            });
        }

        res.status(200).json({
            success: true,
            message: 'Cập nhật kịch bản thành công',
            data: script
        });
    } catch (error) {
        console.error('Update script error:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi khi cập nhật kịch bản'
        });
    }
};

/**
 * Delete script
 * DELETE /api/video-scripts/:id
 */
exports.deleteScript = async (req, res) => {
    try {
        const { id } = req.params;

        // Only delete if owned by current user
        const script = await VideoScript.findOneAndDelete({
            _id: id,
            userId: req.user._id
        });

        if (!script) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy kịch bản'
            });
        }

        res.status(200).json({
            success: true,
            message: 'Xóa kịch bản thành công'
        });
    } catch (error) {
        console.error('Delete script error:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi khi xóa kịch bản'
        });
    }
};

/**
 * Export script to Excel
 * GET /api/video-scripts/:id/export-excel
 */
exports.exportToExcel = async (req, res) => {
    try {
        const { id } = req.params;

        // Only export if owned by current user
        const script = await VideoScript.findOne({
            _id: id,
            userId: req.user._id
        });

        if (!script) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy kịch bản'
            });
        }

        // Generate Excel file
        const buffer = await exportVideoScriptToExcel(script);

        // Set headers for Excel download
        const filename = `kich-ban-${script.title.replace(/[^a-zA-Z0-9]/g, '-').substring(0, 30)}-${Date.now()}.xlsx`;
        
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
        res.setHeader('Content-Length', buffer.length);
        
        res.send(buffer);
    } catch (error) {
        console.error('Export to Excel error:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi khi xuất file Excel'
        });
    }
};
