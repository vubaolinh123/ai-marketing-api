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
router.get('/impersonation-targets', adminController.getImpersonationTargets);

module.exports = router;
