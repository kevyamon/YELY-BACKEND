// src/routes/rideRoutes.js
// ROUTES COURSES - Validation Zod Stricte (GPS & Adresses)
// CSCSM Level: Bank Grade

const express = require('express');
const router = express.Router();
const { z } = require('zod');
const {
  requestRide,
  acceptRide,
  startRide,
  completeRide
} = require('../controllers/rideController');
const { protect, authorize } = require('../middleware/authMiddleware');
const validate = require('../middleware/validationMiddleware');

// ═══════════════════════════════════════════════════════════
// SCHÉMAS ZOD
// ═══════════════════════════════════════════════════════════

// Coordonnées GPS [lng, lat]
const coordinatesSchema = z.tuple([
  z.number().min(-180).max(180), // Longitude
  z.number().min(-90).max(90)    // Latitude
], {
  invalid_type_error: "Coordonnées doivent être des nombres",
  required_error: "Coordonnées requises [lng, lat]"
});

// Point géographique
const pointSchema = z.object({
  address: z.string()
    .min(5, 'Adresse trop courte')
    .max(200, 'Adresse trop longue')
    .trim(),
  coordinates: coordinatesSchema
});

// Demande de course
// Note: On ne valide plus 'distance' car elle est calculée par le serveur (Sécurité Phase 2)
// Mais si le frontend l'envoie pour info, on peut l'ignorer ou le valider sans l'utiliser.
// Ici, on l'exclut du schéma pour être strict (strip unknown).
const requestRideSchema = z.object({
  origin: pointSchema,
  destination: pointSchema,
  forfait: z.enum(['ECHO', 'STANDARD', 'VIP'], {
    errorMap: () => ({ message: 'Forfait invalide (ECHO, STANDARD, VIP)' })
  })
});

// Action sur une course (ID MongoDB)
const rideActionSchema = z.object({
  rideId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'ID course invalide')
});

// ═══════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════

router.post(
  '/request',
  protect,
  authorize('rider', 'superadmin'),
  validate(requestRideSchema),
  requestRide
);

router.post(
  '/accept',
  protect,
  authorize('driver', 'superadmin'),
  validate(rideActionSchema),
  acceptRide
);

router.post(
  '/start',
  protect,
  authorize('driver', 'superadmin'),
  validate(rideActionSchema),
  startRide
);

router.post(
  '/complete',
  protect,
  authorize('driver', 'superadmin'),
  validate(rideActionSchema),
  completeRide
);

module.exports = router;