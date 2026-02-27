const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { protect, authorize } = require('../middlewares');

router.use(protect, authorize('admin'));

router.get('/users', adminController.listUsers);
router.post('/users', adminController.createUser);
router.patch('/users/:id', adminController.updateUser);
router.delete('/users/:id', adminController.deleteUser);
router.patch('/users/:id/password', adminController.resetUserPassword);
router.get('/users/:id/sessions', adminController.getUserSessions);
router.post('/users/:id/sessions/:sessionId/revoke', adminController.revokeUserSession);
router.get('/impersonation-targets', adminController.getImpersonationTargets);
router.get('/token-usage/summary', adminController.getTokenUsageSummary);
router.get('/token-usage/users', adminController.getTokenUsageUsers);
router.get('/token-usage/debug/recent', adminController.getTokenUsageDebugRecent);

module.exports = router;
