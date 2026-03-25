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
  rejectTransactionSchema,
  updateAppVersionSchema
} = require('../validations/adminValidation');

// ACCES ADMIN & SUPERADMIN
router.get('/stats', protect, authorize('admin', 'superadmin'), adminController.getDashboardStats);
router.get('/users', protect, authorize('admin', 'superadmin'), adminController.getAllUsers);
router.get('/validations', protect, authorize('admin', 'superadmin'), adminController.getValidationQueue);
router.get('/rides', protect, authorize('admin', 'superadmin'), adminController.getAllRides); // NOUVEAU : Route pour les courses
router.get('/logs', protect, authorize('admin', 'superadmin'), adminController.getAuditLogs);

router.post('/approve/:id', 
  protect, 
  authorize('admin', 'superadmin'), 
  validate(transactionIdParam, 'params'), 
  adminController.approveTransaction
);

router.post('/reject/:id', 
  protect, 
  authorize('superadmin'), 
  validate(transactionIdParam, 'params'), 
  validate(rejectTransactionSchema), 
  adminController.rejectTransaction
);

// ACCES SUPERADMIN ONLY
router.get('/finance', protect, authorize('superadmin'), adminController.getFinanceData);
router.put('/finance/links', protect, authorize('superadmin'), adminController.updateWaveLinks);
router.put('/promo/toggle', protect, authorize('superadmin'), adminController.togglePromo);

// OPERATIONS SPECIALES ET CHARGE
router.put('/load-reduce/toggle', protect, authorize('superadmin'), adminController.toggleLoadReduce);
router.put('/free-access/toggle', protect, authorize('superadmin'), adminController.toggleGlobalFreeAccess);

// --- MISE A JOUR / CONFIGURATION SYSTEME (Vague 1) ---
router.get('/system-config', protect, authorize('superadmin'), adminController.getSystemConfig);
router.put('/app-version', protect, authorize('superadmin'), validate(updateAppVersionSchema), adminController.updateAppVersion);

router.post('/update-role', protect, authorize('superadmin'), validate(updateRoleSchema), adminController.updateAdminStatus);
router.post('/toggle-ban', protect, authorize('superadmin'), validate(toggleBanSchema), adminController.toggleUserBan);
router.post('/map-lock', protect, authorize('superadmin'), validate(mapSettingsSchema), adminController.updateMapSettings);

module.exports = router;