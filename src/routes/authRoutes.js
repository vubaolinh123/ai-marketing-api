const express = require('express');
const router = express.Router();
const { authController } = require('../controllers');
const { protect } = require('../middlewares');

// Public routes
router.post('/register', authController.register);
router.post('/login', authController.login);

// Protected routes
router.post('/logout', protect, authController.logout);
router.get('/me', protect, authController.getMe);

module.exports = router;
