// src/routes/rideRoutes.js
const express = require('express');
const router = express.Router();
const rideController = require('../controllers/rideController');
const { protect, authorize } = require('../middleware/authMiddleware');
const validate = require('../middleware/validationMiddleware');
const { 
  requestRideSchema, 
  rideActionSchema, 
  submitPriceSchema, 
  finalizeRideSchema 
} = require('../validations/rideValidation');

// LECTURE COURSE EN COURS (La route qui manquait)
router.get('/current', protect, authorize('rider', 'driver', 'seller'), rideController.getCurrentRide);

// ROUTES DE LECTURE & ANNULATION ET RATING
router.get('/estimate', protect, authorize('rider', 'seller', 'superadmin'), rideController.estimateRide);
router.post('/emergency-cancel', protect, authorize('rider', 'seller', 'superadmin'), rideController.emergencyCancel);
router.put('/:id/cancel', protect, authorize('rider', 'driver', 'seller', 'superadmin'), rideController.cancelRide);
router.put('/:id/rate', protect, authorize('rider', 'seller', 'superadmin'), rideController.rateRide);

// HISTORIQUE
router.get('/history', protect, rideController.getRideHistory);
router.delete('/:id/history', protect, rideController.hideFromHistory);

// ROUTES D'ACTION AVEC VALIDATION STRICTE DU BODY
router.post('/request', protect, authorize('rider', 'seller', 'superadmin'), validate(requestRideSchema), rideController.requestRide);
router.post('/lock', protect, authorize('driver', 'superadmin'), validate(rideActionSchema), rideController.lockRide);
router.post('/propose', protect, authorize('driver', 'superadmin'), validate(submitPriceSchema), rideController.submitPrice);
router.post('/finalize', protect, authorize('rider', 'seller', 'superadmin'), validate(finalizeRideSchema), rideController.finalizeRide);
router.post('/arrived', protect, authorize('driver', 'superadmin'), validate(rideActionSchema), rideController.markAsArrived);
router.post('/start', protect, authorize('driver', 'superadmin'), validate(rideActionSchema), rideController.startRide);
router.post('/complete', protect, authorize('driver', 'superadmin'), validate(rideActionSchema), rideController.completeRide);

module.exports = router;