const express = require('express');
const router = express.Router();
const { aiSettingsController } = require('../controllers');
const { protect } = require('../middlewares');

// All routes are protected
router.use(protect);

router.get('/', aiSettingsController.getSettings);
router.put('/', aiSettingsController.updateSettings);
router.patch('/:section', aiSettingsController.updateSection);

module.exports = router;
