/**
 * Marketing Plan Routes
 * API endpoints for marketing plan management
 */

const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares');
const marketingPlanController = require('../controllers/marketingPlan.controller');

// All routes require authentication
router.use(protect);

// Generate marketing plan with AI
router.post('/generate', marketingPlanController.generateMarketingPlan);

// Get all plans
router.get('/', marketingPlanController.getAllPlans);

// Get plan by ID
router.get('/:id', marketingPlanController.getPlanById);

// Delete plan
router.delete('/:id', marketingPlanController.deletePlan);

// Update plan status
router.patch('/:id/status', marketingPlanController.updatePlanStatus);

module.exports = router;
