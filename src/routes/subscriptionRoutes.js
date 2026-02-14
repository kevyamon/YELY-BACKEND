// src/routes/subscriptionRoutes.js
const express = require('express');
const router = express.Router();
const { submitProof } = require('../controllers/subscriptionController');
const { protect, authorize } = require('../middleware/authMiddleware');
// Déstructuration pour récupérer les nouveaux exports de la Phase 4.1
const { uploadSingle, validateFileSignature } = require('../middleware/uploadMiddleware');

// Seuls les chauffeurs (ou superadmin) peuvent envoyer une preuve
// 🛡️ Blindage : uploadSingle (Multer) + validateFileSignature (Magic Bytes)
router.post(
  '/submit-proof', 
  protect, 
  authorize('driver', 'superadmin'), 
  uploadSingle, 
  validateFileSignature, 
  submitProof
);

module.exports = router;