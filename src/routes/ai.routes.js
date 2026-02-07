/**
 * AI Routes
 * Routes for AI-powered features
 */

const express = require('express');
const router = express.Router();
const aiController = require('../controllers/ai.controller');
const { protect } = require('../middlewares');

// All routes require authentication
router.use(protect);

// Generate article with AI (preview only)
router.post('/generate-article', aiController.generateArticle);

// Generate and save article to database
router.post('/generate-and-save', aiController.generateAndSaveArticle);

// Analyze image with AI
router.post('/analyze-image', aiController.analyzeImage);

module.exports = router;
