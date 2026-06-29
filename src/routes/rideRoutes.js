// src/routes/rideRoutes.js
const express = require('express');
const router = express.Router();
const rideController = require('../controllers/rideController');
const { protect, authorize, requireActiveSubscription } = require('../middleware/authMiddleware');
const validate = require('../middleware/validationMiddleware');
const { 
  requestRideSchema, 
  rideActionSchema, 
  submitPriceSchema, 
  finalizeRideSchema,
  collectPointSchema
} = require('../validations/rideValidation');

// LECTURE COURSE EN COURS (La route qui manquait)
router.get('/current', protect, authorize('rider', 'driver', 'seller'), rideController.getCurrentRide);
router.get('/estimate', protect, authorize('rider', 'seller', 'superadmin'), rideController.estimateRide);
router.get('/history', protect, rideController.getRideHistory);

router.get('/:id', protect, authorize('rider', 'driver', 'seller', 'superadmin'), rideController.getRideById);

// ROUTES DE LECTURE & ANNULATION ET RATING
router.post('/emergency-cancel', protect, authorize('rider', 'seller', 'driver', 'superadmin'), rideController.emergencyCancel);
router.put('/:id/cancel', protect, authorize('rider', 'driver', 'seller', 'superadmin'), rideController.cancelRide);
router.put('/:id/rate', protect, authorize('rider', 'seller', 'superadmin'), rideController.rateRide);

// HISTORIQUE
router.delete('/:id/history', protect, rideController.hideFromHistory);

// ROUTES D'ACTION AVEC VALIDATION STRICTE DU BODY
router.post('/request', protect, authorize('rider', 'seller', 'superadmin'), validate(requestRideSchema), rideController.requestRide);
router.post('/lock', protect, authorize('driver', 'superadmin'), requireActiveSubscription, validate(rideActionSchema), rideController.lockRide);
router.post('/propose', protect, authorize('driver', 'superadmin'), requireActiveSubscription, validate(submitPriceSchema), rideController.submitPrice);
router.post('/finalize', protect, authorize('rider', 'seller', 'superadmin'), validate(finalizeRideSchema), rideController.finalizeRide);
router.post('/arrived', protect, authorize('driver', 'superadmin'), requireActiveSubscription, validate(rideActionSchema), rideController.markAsArrived);
router.post('/start', protect, authorize('driver', 'superadmin'), requireActiveSubscription, validate(rideActionSchema), rideController.startRide);
router.post('/complete', protect, authorize('driver', 'superadmin'), requireActiveSubscription, validate(rideActionSchema), rideController.completeRide);
router.post('/collect-point', protect, authorize('driver', 'superadmin'), requireActiveSubscription, validate(collectPointSchema), rideController.collectPoint);

module.exports = router;