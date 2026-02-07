/**
 * Upload Configuration
 * Cấu hình multer cho file upload
 */

const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

// Upload folders
const UPLOAD_FOLDERS = {
    general: 'uploads/images/general',
    articles: 'uploads/images/articles',
    'ai-images': 'uploads/images/ai-images'
};

// Allowed file types
const ALLOWED_TYPES = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg'
};

// File size limit: 10MB
const MAX_FILE_SIZE = 10 * 1024 * 1024;

// Max files for multiple upload
const MAX_FILES = 10;

/**
 * Ensure upload directories exist
 */
const ensureUploadDirs = () => {
    Object.values(UPLOAD_FOLDERS).forEach(folder => {
        const fullPath = path.join(process.cwd(), folder);
        if (!fs.existsSync(fullPath)) {
            fs.mkdirSync(fullPath, { recursive: true });
        }
    });
};

// Create directories on module load
ensureUploadDirs();

/**
 * Get storage configuration for a specific folder
 */
const getStorage = (folderKey = 'general') => {
    const folder = UPLOAD_FOLDERS[folderKey] || UPLOAD_FOLDERS.general;
    
    return multer.diskStorage({
        destination: (req, file, cb) => {
            const fullPath = path.join(process.cwd(), folder);
            cb(null, fullPath);
        },
        filename: (req, file, cb) => {
            // Generate unique filename with UUID
            const ext = ALLOWED_TYPES[file.mimetype] || path.extname(file.originalname).slice(1);
            const uniqueName = `${uuidv4()}.${ext}`;
            cb(null, uniqueName);
        }
    });
};

/**
 * File filter - validate file type
 */
const fileFilter = (req, file, cb) => {
    if (ALLOWED_TYPES[file.mimetype]) {
        cb(null, true);
    } else {
        cb(new Error(`Định dạng file không hợp lệ. Chỉ chấp nhận: ${Object.values(ALLOWED_TYPES).join(', ')}`), false);
    }
};

/**
 * Create multer upload instance for specific folder
 */
const createUploader = (folderKey = 'general') => {
    return multer({
        storage: getStorage(folderKey),
        fileFilter: fileFilter,
        limits: {
            fileSize: MAX_FILE_SIZE,
            files: MAX_FILES
        }
    });
};

/**
 * Get URL path for uploaded file
 */
const getFileUrl = (filename, folderKey = 'general') => {
    const folder = UPLOAD_FOLDERS[folderKey] || UPLOAD_FOLDERS.general;
    return `/${folder}/${filename}`;
};

/**
 * Delete file from uploads
 */
const deleteFile = (filename, folderKey = 'general') => {
    const folder = UPLOAD_FOLDERS[folderKey] || UPLOAD_FOLDERS.general;
    const filePath = path.join(process.cwd(), folder, filename);
    
    return new Promise((resolve, reject) => {
        fs.unlink(filePath, (err) => {
            if (err) {
                if (err.code === 'ENOENT') {
                    resolve(false); // File không tồn tại
                } else {
                    reject(err);
                }
            } else {
                resolve(true);
            }
        });
    });
};

module.exports = {
    UPLOAD_FOLDERS,
    ALLOWED_TYPES,
    MAX_FILE_SIZE,
    MAX_FILES,
    createUploader,
    getFileUrl,
    deleteFile,
    ensureUploadDirs
};
