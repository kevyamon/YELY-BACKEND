// src/routes/reportRoutes.js
const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const { protect, authorize } = require('../middleware/authMiddleware');
const { uploadReportCaptures, validateFileSignature } = require('../middleware/uploadMiddleware');

router.use(protect);
router.post('/submit', uploadReportCaptures, validateFileSignature, reportController.submitReport);
router.get('/my-reports', reportController.getMyReports);
// AJOUT SENIOR: Nouvelle route pour que le plaintif puisse supprimer son signalement
router.delete('/my-reports/:id', reportController.deleteMyReport);

// Admin Only
router.get('/all', authorize('admin', 'superadmin'), reportController.getAllReports);
router.patch('/:id/resolve', authorize('admin', 'superadmin'), reportController.resolveReport);
router.delete('/:id', authorize('admin', 'superadmin'), reportController.deleteReport); 

module.exports = router;