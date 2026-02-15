// src/validations/userValidation.js
// CONTRATS D'IDENTITÉ - Zod Strict
// CSCSM Level: Bank Grade

const { z } = require('zod');

const updateProfileSchema = z.object({
  name: z.string()
    .min(2, 'Le nom doit faire au moins 2 caractères')
    .max(50, 'Le nom ne peut dépasser 50 caractères')
    .regex(/^[a-zA-Z\u00C0-\u00FF\s'-]+$/, 'Caractères non autorisés')
    .trim()
    .optional(),
    
  email: z.string()
    .email('Format email invalide')
    .trim()
    .toLowerCase()
    .optional(),
    
  phone: z.string()
    .regex(/^\+?[0-9\s]{8,20}$/, 'Format téléphone invalide')
    .trim()
    .optional()
}).strict().refine(data => Object.keys(data).length > 0, {
  message: "Au moins un champ est requis pour la mise à jour"
});

module.exports = { updateProfileSchema };