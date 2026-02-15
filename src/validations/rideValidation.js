// src/validations/rideValidation.js
// CONTRATS DE DONNÉES RIDE - Zod Strict
// CSCSM Level: Bank Grade

const { z } = require('zod');

// Coordonnées GPS [lng, lat]
const coordinatesSchema = z.tuple([
  z.number().min(-180).max(180), // Longitude
  z.number().min(-90).max(90)    // Latitude
], {
  invalid_type_error: "Les coordonnées doivent être des nombres",
  required_error: "Coordonnées requises [longitude, latitude]"
});

// Point géographique complet
const pointSchema = z.object({
  address: z.string()
    .min(5, 'Adresse trop courte')
    .max(200, 'Adresse trop longue')
    .trim(),
  coordinates: coordinatesSchema
});

/**
 * Schéma de demande de course
 * Note: On utilise .strict() pour empêcher l'injection de champs inconnus
 */
const requestRideSchema = z.object({
  origin: pointSchema,
  destination: pointSchema,
  forfait: z.enum(['ECHO', 'STANDARD', 'VIP'], {
    errorMap: () => ({ message: 'Forfait invalide (ECHO, STANDARD, VIP)' })
  })
}).strict();

/**
 * Schéma pour les actions nécessitant un ID de course
 */
const rideActionSchema = z.object({
  rideId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'ID de course invalide')
}).strict();

module.exports = {
  requestRideSchema,
  rideActionSchema
};