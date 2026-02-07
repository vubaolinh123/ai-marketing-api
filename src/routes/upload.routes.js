/**
 * Upload Routes
 * Routes cho file upload
 */

const express = require('express');
const router = express.Router();
const uploadController = require('../controllers/upload.controller');
const { uploadSingle, uploadMultiple, requireFile } = require('../middlewares/upload.middleware');
const { protect } = require('../middlewares');

// All routes require authentication
router.use(protect);

// Get available folders
router.get('/folders', uploadController.getFolders);

// Upload single image to specific folder
// POST /api/upload/image/:folder (folder: general, articles, ai-images)
router.post('/image/:folder',
    (req, res, next) => {
        const folder = req.params.folder || 'general';
        uploadSingle(folder, 'image')(req, res, next);
    },
    requireFile,
    uploadController.uploadSingleImage
);

// Upload single image to general folder (default)
router.post('/image',
    uploadSingle('general', 'image'),
    requireFile,
    uploadController.uploadSingleImage
);

// Upload multiple images to specific folder
// POST /api/upload/images/:folder
router.post('/images/:folder',
    (req, res, next) => {
        const folder = req.params.folder || 'general';
        uploadMultiple(folder, 'images', 10)(req, res, next);
    },
    requireFile,
    uploadController.uploadMultipleImages
);

// Upload multiple images to general folder (default)
router.post('/images',
    uploadMultiple('general', 'images', 10),
    requireFile,
    uploadController.uploadMultipleImages
);

// Delete image
// DELETE /api/upload/image/:folder/:filename
router.delete('/image/:folder/:filename', uploadController.deleteImage);

module.exports = router;
