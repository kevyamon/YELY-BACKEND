// src/validations/rideValidation.js
// CONTRATS DE DONNÉES RIDE - Zod Strict
// CSCSM Level: Bank Grade

const { z } = require('zod');

// Coordonnees GPS strictes [longitude, latitude]
const coordinatesSchema = z.tuple([
  z.number({ required_error: "Longitude requise", invalid_type_error: "La longitude doit etre un nombre" })
    .min(-180, "Longitude minimale -180")
    .max(180, "Longitude maximale 180"),
  z.number({ required_error: "Latitude requise", invalid_type_error: "La latitude doit etre un nombre" })
    .min(-90, "Latitude minimale -90")
    .max(90, "Latitude maximale 90")
]);

// Point geographique complet
const pointSchema = z.object({
  address: z.string({ required_error: "Adresse requise" }).min(5, "Adresse trop courte").max(200, "Adresse trop longue").trim(),
  coordinates: coordinatesSchema
}).strict();

// 1. DEMANDE DE COURSE (Rider)
const requestRideSchema = z.object({
  body: z.object({
    origin: pointSchema,
    destination: pointSchema,
    forfait: z.enum(['ECHO', 'STANDARD', 'VIP']).optional().default('STANDARD')
  }).strict()
});

// 2. ACTION GENERIQUE (ID seul)
const rideActionSchema = z.object({
  body: z.object({
    rideId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'ID de course invalide')
  }).strict()
});

// 3. PROPOSITION DE PRIX (Driver)
const submitPriceSchema = z.object({
  body: z.object({
    rideId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'ID de course invalide'),
    amount: z.number().int().positive('Le montant doit etre positif')
  }).strict()
});

// 4. DECISION CLIENT (Rider)
const finalizeRideSchema = z.object({
  body: z.object({
    rideId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'ID de course invalide'),
    decision: z.enum(['ACCEPTED', 'REJECTED'], {
      errorMap: () => ({ message: 'Decision invalide (ACCEPTED ou REJECTED)' })
    })
  }).strict()
});

module.exports = {
  requestRideSchema,
  rideActionSchema,
  submitPriceSchema,
  finalizeRideSchema
};