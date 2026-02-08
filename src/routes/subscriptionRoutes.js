const express = require('express');
const router = express.Router();
const { submitProof } = require('../controllers/subscriptionController');
const { protect, authorize } = require('../middleware/authMiddleware');
const upload = require('../middleware/uploadMiddleware');

// Seuls les chauffeurs (ou superadmin) peuvent envoyer une preuve
router.post('/submit-proof', protect, authorize('driver', 'superadmin'), upload.single('image'), submitProof);

module.exports = router;