// src/validations/rideValidation.js
// CONTRATS DE DONNÉES RIDE - Zod Strict
// CSCSM Level: Bank Grade

const { z } = require('zod');

// Coordonnées GPS [lng, lat]
const coordinatesSchema = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90)
], {
  invalid_type_error: "Les coordonnées doivent être des nombres",
  required_error: "Coordonnées requises [longitude, latitude]"
});

// Point géographique complet
const pointSchema = z.object({
  address: z.string().min(5).max(200).trim(),
  coordinates: coordinatesSchema
});

// 1. DEMANDE DE COURSE
const requestRideSchema = z.object({
  origin: pointSchema,
  destination: pointSchema,
  forfait: z.enum(['ECHO', 'STANDARD', 'VIP']) // Optionnel si géré par défaut
    .optional() 
    .default('STANDARD')
}).strict();

// 2. ACTION GÉNÉRIQUE (ID seul)
const rideActionSchema = z.object({
  rideId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'ID de course invalide')
}).strict();

// 3. PROPOSITION DE PRIX (Driver)
const submitPriceSchema = z.object({
  rideId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'ID de course invalide'),
  amount: z.number().int().positive('Le montant doit être positif')
}).strict();

// 4. DÉCISION CLIENT (Rider)
const finalizeRideSchema = z.object({
  rideId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'ID de course invalide'),
  decision: z.enum(['ACCEPTED', 'REFUSED'], {
    errorMap: () => ({ message: 'Décision invalide (ACCEPTED ou REFUSED)' })
  })
}).strict();

module.exports = {
  requestRideSchema,
  rideActionSchema,
  submitPriceSchema,
  finalizeRideSchema
};