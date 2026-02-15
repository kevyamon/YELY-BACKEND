// src/routes/rideRoutes.js
// ROUTES COURSES - Flux de Négociation & Sécurité
// CSCSM Level: Bank Grade

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

// 1. DEMANDE (Rider)
router.post(
  '/request',
  protect,
  authorize('rider', 'superadmin'),
  validate(requestRideSchema),
  rideController.requestRide
);

// 2. VERROUILLER / PRENDRE LA COURSE (Driver)
// "Je suis intéressé, je bloque la course"
router.post(
  '/lock',
  protect,
  authorize('driver', 'superadmin'),
  validate(rideActionSchema),
  rideController.lockRide
);

// 3. PROPOSER UN PRIX (Driver)
// "Voici mon prix parmi les 3 options"
router.post(
  '/propose',
  protect,
  authorize('driver', 'superadmin'),
  validate(submitPriceSchema),
  rideController.submitPrice
);

// 4. FINALISER / DÉCISION (Rider)
// "J'accepte ou Je refuse ce prix"
router.post(
  '/finalize',
  protect,
  authorize('rider', 'superadmin'),
  validate(finalizeRideSchema),
  rideController.finalizeRide
);

// 5. ACTIONS DE FLUX (Start/Complete)
router.post('/start', protect, authorize('driver', 'superadmin'), validate(rideActionSchema), rideController.startRide);
router.post('/complete', protect, authorize('driver', 'superadmin'), validate(rideActionSchema), rideController.completeRide);

module.exports = router;