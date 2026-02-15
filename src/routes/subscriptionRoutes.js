// src/routes/subscriptionRoutes.js
// ROUTES SOUSCRIPTION - Blindage & Validation
// CSCSM Level: Bank Grade

const express = require('express');
const router = express.Router();
const { submitProof } = require('../controllers/subscriptionController');
const { protect, authorize } = require('../middleware/authMiddleware');
const { uploadSingle, validateFileSignature } = require('../middleware/uploadMiddleware');
const validate = require('../middleware/validationMiddleware');
const { submitProofSchema } = require('../validations/subscriptionValidation');

/**
 * @route   POST /api/v1/subscriptions/submit-proof
 * @desc    Soumission d'une preuve de paiement avec validation multicouche
 * 🛡️ Pipeline : Auth -> Autorisation -> Upload -> Signature File -> Validation Body -> Controller
 */
router.post(
  '/submit-proof', 
  protect, 
  authorize('driver', 'superadmin'), 
  uploadSingle, 
  validateFileSignature, 
  validate(submitProofSchema), 
  submitProof
);

module.exports = router;