// backend/src/validations/rideValidation.js
// CONTRATS DE DONNÉES RIDE - Zod Flexible (Correction Blocage)
// CSCSM Level: Bank Grade

const { z } = require('zod');

// Coordonnées GPS [lng, lat]
const coordinatesSchema = z.tuple([
  z.number({ required_error: "Longitude requise", invalid_type_error: "La longitude doit être un nombre" })
    .min(-180, "Longitude minimale -180")
    .max(180, "Longitude maximale 180"),
  z.number({ required_error: "Latitude requise", invalid_type_error: "La latitude doit être un nombre" })
    .min(-90, "Latitude minimale -90")
    .max(90, "Latitude maximale 90")
]);

// Point géographique complet
const pointSchema = z.object({
  address: z.string({ required_error: "Adresse requise" }).min(5, "Adresse trop courte").max(200, "Adresse trop longue").trim(),
  coordinates: coordinatesSchema
}); // 🚀 .strict() SUPPRIMÉ ICI

// 1. DEMANDE DE COURSE (Rider)
const requestRideSchema = z.object({
  origin: pointSchema,
  destination: pointSchema,
  forfait: z.enum(['ECHO', 'STANDARD', 'VIP']).optional().default('STANDARD')
}); // 🚀 .strict() SUPPRIMÉ ICI

// 2. ACTION GÉNÉRIQUE (ID seul)
const rideActionSchema = z.object({
  rideId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'ID de course invalide')
}); // 🚀 .strict() SUPPRIMÉ ICI

// 3. PROPOSITION DE PRIX (Driver)
const submitPriceSchema = z.object({
  rideId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'ID de course invalide'),
  amount: z.number().positive('Le montant doit être positif')
}); // 🚀 .strict() SUPPRIMÉ ICI

// 4. DÉCISION CLIENT (Rider)
const finalizeRideSchema = z.object({
  rideId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'ID de course invalide'),
  decision: z.enum(['ACCEPTED', 'REJECTED'], {
    errorMap: () => ({ message: 'Décision invalide (ACCEPTED ou REJECTED)' })
  })
}); // 🚀 .strict() SUPPRIMÉ ICI

module.exports = {
  requestRideSchema,
  rideActionSchema,
  submitPriceSchema,
  finalizeRideSchema
};