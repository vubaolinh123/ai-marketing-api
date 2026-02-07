/**
 * Upload Controller
 * Xử lý upload và quản lý file
 */

const { getFileUrl, deleteFile, UPLOAD_FOLDERS } = require('../config/upload.config');

/**
 * Upload single image
 * POST /api/upload/image/:folder
 */
exports.uploadSingleImage = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'Không có file được upload'
            });
        }

        const folder = req.params.folder || 'general';
        const { filename, size, mimetype, originalname } = req.file;

        res.status(201).json({
            success: true,
            message: 'Upload thành công',
            data: {
                filename,
                originalname,
                url: getFileUrl(filename, folder),
                size,
                mimetype
            }
        });
    } catch (error) {
        console.error('Upload single error:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi khi upload file'
        });
    }
};

/**
 * Upload multiple images
 * POST /api/upload/images/:folder
 */
exports.uploadMultipleImages = async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Không có file được upload'
            });
        }

        const folder = req.params.folder || 'general';
        const files = req.files.map(file => ({
            filename: file.filename,
            originalname: file.originalname,
            url: getFileUrl(file.filename, folder),
            size: file.size,
            mimetype: file.mimetype
        }));

        res.status(201).json({
            success: true,
            message: `Upload thành công ${files.length} file`,
            data: {
                files,
                count: files.length
            }
        });
    } catch (error) {
        console.error('Upload multiple error:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi khi upload files'
        });
    }
};

/**
 * Delete image
 * DELETE /api/upload/image/:folder/:filename
 */
exports.deleteImage = async (req, res) => {
    try {
        const { folder, filename } = req.params;

        // Validate folder
        if (!UPLOAD_FOLDERS[folder]) {
            return res.status(400).json({
                success: false,
                message: 'Folder không hợp lệ'
            });
        }

        // Validate filename (prevent path traversal)
        if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
            return res.status(400).json({
                success: false,
                message: 'Tên file không hợp lệ'
            });
        }

        const deleted = await deleteFile(filename, folder);

        if (deleted) {
            res.json({
                success: true,
                message: 'Xóa file thành công'
            });
        } else {
            res.status(404).json({
                success: false,
                message: 'File không tồn tại'
            });
        }
    } catch (error) {
        console.error('Delete image error:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi khi xóa file'
        });
    }
};

/**
 * Get available folders
 * GET /api/upload/folders
 */
exports.getFolders = (req, res) => {
    res.json({
        success: true,
        data: {
            folders: Object.keys(UPLOAD_FOLDERS),
            paths: UPLOAD_FOLDERS
        }
    });
};
