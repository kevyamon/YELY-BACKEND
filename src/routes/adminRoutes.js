// src/routes/adminRoutes.js
// ROUTES GOUVERNANCE - Validation & Permissions
// CSCSM Level: Bank Grade

const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { protect, authorize } = require('../middleware/authMiddleware');
const validate = require('../middleware/validationMiddleware');
const { 
  updateRoleSchema, 
  toggleBanSchema, 
  mapSettingsSchema, 
  transactionIdParam,
  rejectTransactionSchema
} = require('../validations/adminValidation');

// ACCES ADMIN & SUPERADMIN
router.get('/stats', protect, authorize('admin', 'superadmin'), adminController.getDashboardStats);
router.get('/validations', protect, authorize('admin', 'superadmin'), adminController.getValidationQueue);
router.get('/users', protect, authorize('admin', 'superadmin'), adminController.getAllUsers);

router.post('/approve/:id', 
  protect, 
  authorize('admin', 'superadmin'), 
  validate(transactionIdParam, 'params'), 
  adminController.approveTransaction
);

router.post('/reject/:id', 
  protect, 
  authorize('admin', 'superadmin'), 
  validate(transactionIdParam, 'params'), 
  validate(rejectTransactionSchema), 
  adminController.rejectTransaction
);

// ACCES SUPERADMIN ONLY
router.get('/finance', protect, authorize('superadmin'), adminController.getFinanceData);
router.put('/finance/links', protect, authorize('superadmin'), adminController.updateWaveLinks);
router.put('/promo/toggle', protect, authorize('superadmin'), adminController.togglePromo);

router.post('/update-role', protect, authorize('superadmin'), validate(updateRoleSchema), adminController.updateAdminStatus);
router.post('/toggle-ban', protect, authorize('superadmin'), validate(toggleBanSchema), adminController.toggleUserBan);
router.post('/map-lock', protect, authorize('superadmin'), validate(mapSettingsSchema), adminController.updateMapSettings);

module.exports = router;