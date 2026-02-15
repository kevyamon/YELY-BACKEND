// src/routes/rideRoutes.js
// ROUTES COURSES - Blindage & Autorisations
// CSCSM Level: Bank Grade

const express = require('express');
const router = express.Router();
const rideController = require('../controllers/rideController');
const { protect, authorize } = require('../middleware/authMiddleware');
const validate = require('../middleware/validationMiddleware');

// Import des schémas centralisés
const { requestRideSchema, rideActionSchema } = require('../validations/rideValidation');

// ═══════════════════════════════════════════════════════════
// ROUTES SÉCURISÉES
// ═══════════════════════════════════════════════════════════

// Demander une course (Réservé aux Riders et Admin)
router.post(
  '/request',
  protect,
  authorize('rider', 'superadmin'),
  validate(requestRideSchema),
  rideController.requestRide
);

// Accepter une course (Réservé aux Drivers et Admin)
router.post(
  '/accept',
  protect,
  authorize('driver', 'superadmin'),
  validate(rideActionSchema),
  rideController.acceptRide
);

// Démarrer la course
router.post(
  '/start',
  protect,
  authorize('driver', 'superadmin'),
  validate(rideActionSchema),
  rideController.startRide
);

// Terminer la course
router.post(
  '/complete',
  protect,
  authorize('driver', 'superadmin'),
  validate(rideActionSchema),
  rideController.completeRide
);

module.exports = router;