/**
 * Video Script Routes
 * All routes require authentication
 */

const express = require('express');
const router = express.Router();
const videoScriptController = require('../controllers/videoScript.controller');
const { protect } = require('../middlewares');

// All routes require authentication
router.use(protect);

// Generate routes
router.post('/generate', videoScriptController.generateScript);
router.post('/generate-idea', videoScriptController.generateIdea);
router.post('/suggest-concepts', videoScriptController.suggestConcepts);

// CRUD routes
router.get('/', videoScriptController.getAllScripts);
router.get('/:id', videoScriptController.getScriptById);
router.get('/:id/export-excel', videoScriptController.exportToExcel);
router.put('/:id', videoScriptController.updateScript);
router.delete('/:id', videoScriptController.deleteScript);

module.exports = router;
