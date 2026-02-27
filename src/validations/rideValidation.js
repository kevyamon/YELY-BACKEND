// backend/src/validations/rideValidation.js
// CONTRATS DE DONNEES RIDE - Zod Flexible & Messages Explicites
// CSCSM Level: Bank Grade

const { z } = require('zod');

const coordinatesSchema = z.tuple([
  z.number({ required_error: "Longitude requise", invalid_type_error: "La longitude doit etre un nombre" })
    .min(-180, "Longitude minimale -180")
    .max(180, "Longitude maximale 180"),
  z.number({ required_error: "Latitude requise", invalid_type_error: "La latitude doit etre un nombre" })
    .min(-90, "Latitude minimale -90")
    .max(90, "Latitude maximale 90")
]);

const pointSchema = z.object({
  address: z.string({ required_error: "Adresse requise" }).min(5, "Adresse trop courte").max(200, "Adresse trop longue").trim(),
  coordinates: coordinatesSchema
}); 

const requestRideSchema = z.object({
  origin: pointSchema,
  destination: pointSchema,
  forfait: z.enum(['ECHO', 'STANDARD', 'VIP']).optional().default('STANDARD')
}); 

const rideActionSchema = z.object({
  rideId: z.string({
    required_error: "L'ID de la course est requis",
    invalid_type_error: "L'ID doit etre une chaine de caracteres"
  }).regex(/^[0-9a-fA-F]{24}$/, 'ID de course invalide')
}); 

const submitPriceSchema = z.object({
  rideId: z.string({
    required_error: "L'ID de la course est requis",
    invalid_type_error: "L'ID doit etre une chaine de caracteres"
  }).regex(/^[0-9a-fA-F]{24}$/, 'ID de course invalide'),
  amount: z.number({
    required_error: "Le montant est requis",
    invalid_type_error: "Le montant doit etre un nombre"
  }).positive('Le montant doit etre positif')
}); 

const finalizeRideSchema = z.object({
  rideId: z.string({
    required_error: "L'ID de la course est requis",
    invalid_type_error: "L'ID doit etre une chaine de caracteres"
  }).regex(/^[0-9a-fA-F]{24}$/, 'ID de course invalide'),
  decision: z.enum(['ACCEPTED', 'REJECTED'], {
    errorMap: () => ({ message: 'Decision invalide (ACCEPTED ou REJECTED)' })
  })
}); 

module.exports = {
  requestRideSchema,
  rideActionSchema,
  submitPriceSchema,
  finalizeRideSchema
};