/**
 * Product Image Routes
 * All routes require authentication
 */

const express = require('express');
const router = express.Router();
const productImageController = require('../controllers/productImage.controller');
const { protect } = require('../middlewares');

// All routes require authentication
router.use(protect);

// Generate routes
router.post('/generate', productImageController.generateProductImage);
router.post('/:id/regenerate', productImageController.regenerateProductImage);

// CRUD routes
router.get('/', productImageController.getAllProductImages);
router.get('/:id', productImageController.getProductImageById);
router.delete('/:id', productImageController.deleteProductImage);

module.exports = router;
