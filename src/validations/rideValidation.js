// src/validations/rideValidation.js
// CONTRATS DE DONNEES RIDE - Zod Flexible & Messages Explicites
// CSCSM Level: Bank Grade

const { z } = require('zod');

const coordinatesSchema = z.tuple([
  z.number({ required_error: "La position géographique (longitude) est requise.", invalid_type_error: "Format de longitude invalide." })
    .min(-180, "Position invalide.")
    .max(180, "Position invalide."),
  z.number({ required_error: "La position géographique (latitude) est requise.", invalid_type_error: "Format de latitude invalide." })
    .min(-90, "Position invalide.")
    .max(90, "Position invalide.")
]);

const pointSchema = z.object({
  address: z.string({ required_error: "Veuillez fournir une adresse valide." })
    .min(5, "L'adresse indiquée est trop courte.")
    .max(200, "L'adresse indiquée est trop longue.")
    .trim(),
  coordinates: coordinatesSchema
}); 

const requestRideSchema = z.object({
  origin: pointSchema,
  destination: pointSchema,
  forfait: z.enum(['ECHO', 'STANDARD', 'VIP']).optional().default('STANDARD'),
  passengersCount: z.number({ invalid_type_error: "Le nombre de passagers doit être un nombre." })
    .int("Le nombre de passagers doit être un entier.")
    .min(1, "Il faut au moins 1 passager pour la course.")
    .max(4, "Le nombre maximum de passagers autorisés est de 4.")
    .optional()
    .default(1)
}); 

const rideActionSchema = z.object({
  rideId: z.string({
    required_error: "L'identifiant de la course est manquant.",
    invalid_type_error: "L'identifiant de la course est invalide."
  })
  .trim()
  .regex(/^[0-9a-fA-F]{24}$/, 'Identifiant de course non reconnu.')
}); 

const submitPriceSchema = z.object({
  rideId: z.string({
    required_error: "L'identifiant de la course est manquant.",
    invalid_type_error: "L'identifiant de la course est invalide."
  })
  .trim()
  .regex(/^[0-9a-fA-F]{24}$/, 'Identifiant de course non reconnu.'),
  amount: z.number({
    required_error: "Veuillez indiquer un montant.",
    invalid_type_error: "Le montant proposé doit être un nombre valide."
  }).positive('Le montant proposé doit être supérieur à zéro.')
}); 

const finalizeRideSchema = z.object({
  rideId: z.string({
    required_error: "L'identifiant de la course est manquant.",
    invalid_type_error: "L'identifiant de la course est invalide."
  })
  .trim()
  .regex(/^[0-9a-fA-F]{24}$/, 'Identifiant de course non reconnu.'),
  decision: z.enum(['ACCEPTED', 'REJECTED'], {
    errorMap: () => ({ message: 'La décision doit être soit acceptée, soit refusée.' })
  })
}); 

module.exports = {
  requestRideSchema,
  rideActionSchema,
  submitPriceSchema,
  finalizeRideSchema
};