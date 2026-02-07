const express = require('express');
const router = express.Router();
const { userController } = require('../controllers');
const { protect } = require('../middlewares');

// All routes are protected
router.use(protect);

router.get('/profile', userController.getProfile);
router.put('/profile', userController.updateProfile);
router.put('/change-password', userController.changePassword);

module.exports = router;
