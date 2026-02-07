/**
 * Upload Middleware
 * Wrapper middleware với error handling cho multer
 */

const { createUploader } = require('../config/upload.config');

/**
 * Handle multer errors with proper messages
 */
const handleMulterError = (err, req, res, next) => {
    if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                message: 'File quá lớn. Kích thước tối đa là 10MB'
            });
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({
                success: false,
                message: 'Số lượng file vượt quá giới hạn cho phép'
            });
        }
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
            return res.status(400).json({
                success: false,
                message: 'Field name không hợp lệ'
            });
        }
        // Custom error from fileFilter
        return res.status(400).json({
            success: false,
            message: err.message || 'Lỗi upload file'
        });
    }
    next();
};

/**
 * Create upload middleware for single file
 * @param {string} folderKey - Folder key: 'general', 'articles', 'ai-images'
 * @param {string} fieldName - Form field name (default: 'image')
 */
const uploadSingle = (folderKey = 'general', fieldName = 'image') => {
    const uploader = createUploader(folderKey);
    
    return (req, res, next) => {
        uploader.single(fieldName)(req, res, (err) => {
            handleMulterError(err, req, res, next);
        });
    };
};

/**
 * Create upload middleware for multiple files
 * @param {string} folderKey - Folder key: 'general', 'articles', 'ai-images'
 * @param {string} fieldName - Form field name (default: 'images')
 * @param {number} maxCount - Max number of files (default: 10)
 */
const uploadMultiple = (folderKey = 'general', fieldName = 'images', maxCount = 10) => {
    const uploader = createUploader(folderKey);
    
    return (req, res, next) => {
        uploader.array(fieldName, maxCount)(req, res, (err) => {
            handleMulterError(err, req, res, next);
        });
    };
};

/**
 * Validate that file was uploaded
 */
const requireFile = (req, res, next) => {
    if (!req.file && (!req.files || req.files.length === 0)) {
        return res.status(400).json({
            success: false,
            message: 'Vui lòng chọn file để upload'
        });
    }
    next();
};

module.exports = {
    uploadSingle,
    uploadMultiple,
    requireFile,
    handleMulterError
};
