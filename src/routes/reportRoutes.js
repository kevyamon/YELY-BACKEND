// src/routes/reportRoutes.js
const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const { protect, authorize } = require('../middleware/authMiddleware');
const { uploadReportCaptures, validateFileSignature } = require('../middleware/uploadMiddleware');

router.use(protect);
router.post('/submit', uploadReportCaptures, validateFileSignature, reportController.submitReport);
router.get('/my-reports', reportController.getMyReports);

// Admin Only
router.get('/all', authorize('admin', 'superadmin'), reportController.getAllReports);
router.patch('/:id/resolve', authorize('admin', 'superadmin'), reportController.resolveReport);

module.exports = router;