const express = require('express');
const router = express.Router();
const { authController } = require('../controllers');
const { protect } = require('../middlewares');

// Public routes
router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/refresh', authController.refresh);
router.post('/logout', authController.logout);

// Protected routes
router.post('/logout-all', protect, authController.logoutAll);
router.get('/me', protect, authController.getMe);
router.get('/sessions', protect, authController.getSessions);
router.post('/sessions/:sessionId/revoke', protect, authController.revokeSession);
router.post('/sessions/revoke-others', protect, authController.revokeOtherSessions);

module.exports = router;
