// src/routes/rideRoutes.js
// ROUTES COURSES - Validation Joi stricte, Protection injection GPS
// CSCSM Level: Bank Grade

const express = require('express');
const router = express.Router();
const Joi = require('joi');
const {
  requestRide,
  acceptRide,
  startRide,
  completeRide
} = require('../controllers/rideController');
const { protect, authorize } = require('../middleware/authMiddleware');
const validate = require('../middleware/validationMiddleware');

// ═══════════════════════════════════════════════════════════
// OPTIONS JOI
// ═══════════════════════════════════════════════════════════

const joiOptions = {
  abortEarly: false,
  stripUnknown: true,
  convert: true // Conversion numérique pour coordonnées
};

// ═══════════════════════════════════════════════════════════
// SCHÉMAS VALIDATION
// ═══════════════════════════════════════════════════════════

// Coordonnées GPS strictes [longitude, latitude]
const coordinatesSchema = Joi.array()
  .length(2)
  .ordered(
    Joi.number().min(-180).max(180).required(), // longitude
    Joi.number().min(-90).max(90).required()    // latitude
  )
  .required()
  .messages({
    'array.length': 'Coordonnées doivent être [longitude, latitude]',
    'number.min': 'Coordonnée hors limites',
    'number.max': 'Coordonnée hors limites'
  });

// Point géographique (adresse + coordonnées)
const pointSchema = Joi.object({
  address: Joi.string()
    .trim()
    .min(5)
    .max(200)
    .required()
    .messages({
      'string.empty': 'Adresse requise',
      'string.min': 'Adresse trop courte',
      'string.max': 'Adresse trop longue (200 caractères max)'
    }),
  coordinates: coordinatesSchema
}).required();

const requestRideSchema = Joi.object({
  origin: pointSchema,
  destination: pointSchema,
  forfait: Joi.string()
    .valid('ECHO', 'STANDARD', 'VIP')
    .required()
    .messages({
      'any.only': 'Forfait invalide (ECHO, STANDARD, VIP)'
    }),
  // Distance fournie par client mais recalculée/vérifiée côté serveur
  distance: Joi.number()
    .positive()
    .max(100)
    .required()
    .messages({
      'number.positive': 'Distance invalide',
      'number.max': 'Distance trop grande (max 100km)'
    })
}).options(joiOptions);

const rideActionSchema = Joi.object({
  rideId: Joi.string()
    .pattern(/^[0-9a-fA-F]{24}$/) // ObjectId strict
    .required()
    .messages({
      'string.pattern.base': 'ID course invalide',
      'string.empty': 'ID course requis'
    })
}).options(joiOptions);

// ═══════════════════════════════════════════════════════════
// ROUTES PROTECTÉES
// ═══════════════════════════════════════════════════════════

// Passager demande une course
router.post(
  '/request',
  protect,
  authorize('rider', 'superadmin'),
  validate(requestRideSchema),
  requestRide
);

// Chauffeur accepte une course
router.post(
  '/accept',
  protect,
  authorize('driver', 'superadmin'),
  validate(rideActionSchema),
  acceptRide
);

// Chauffeur démarre la course
router.post(
  '/start',
  protect,
  authorize('driver', 'superadmin'),
  validate(rideActionSchema),
  startRide
);

// Chauffeur termine la course
router.post(
  '/complete',
  protect,
  authorize('driver', 'superadmin'),
  validate(rideActionSchema),
  completeRide
);

module.exports = router;