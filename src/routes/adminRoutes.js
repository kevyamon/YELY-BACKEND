const express = require('express');
const router = express.Router();
const { 
  getValidationQueue, 
  approveTransaction, 
  rejectTransaction, 
  getAllUsers,
  updateAdminStatus,
  toggleUserBan,
  updateMapSettings
} = require('../controllers/adminController');
const { protect, authorize } = require('../middleware/authMiddleware');

// ACCÈS ADMIN & SUPERADMIN
router.get('/validations', protect, authorize('admin', 'superadmin'), getValidationQueue);
router.get('/users', protect, authorize('admin', 'superadmin'), getAllUsers);
router.post('/approve/:id', protect, authorize('admin', 'superadmin'), approveTransaction);
router.post('/reject/:id', protect, authorize('admin', 'superadmin'), rejectTransaction);

// ACCÈS SUPERADMIN ONLY
router.post('/update-role', protect, authorize('superadmin'), updateAdminStatus);
router.post('/toggle-ban', protect, authorize('superadmin'), toggleUserBan);
router.post('/map-lock', protect, authorize('superadmin'), updateMapSettings);

module.exports = router;