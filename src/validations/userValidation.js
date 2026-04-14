//src/validations/userValidation.js
// CONTRATS D'IDENTITE - Zod Strict
// CSCSM Level: Bank Grade

const { z } = require('zod');

const updateProfileSchema = z.object({
  name: z.string()
    .min(2, 'Votre nom doit faire au moins 2 caracteres.')
    .max(50, 'Votre nom est un peu trop long (maximum 50 caracteres).')
    .regex(/^[a-zA-Z\u00C0-\u00FF\s'-]+$/, 'Votre nom ne doit contenir ni chiffres ni caracteres speciaux.')
    .trim()
    .optional(),
    
  email: z.string()
    .email('Veuillez fournir une adresse e-mail valide.')
    .trim()
    .toLowerCase()
    .optional(),
    
  phone: z.string()
    .regex(/^\+?[0-9\s]{8,20}$/, 'Veuillez fournir un numero de telephone valide.')
    .trim()
    .optional(),

  hasFollowedFB: z.boolean().optional()
}).strict().refine(data => Object.keys(data).length > 0, {
  message: "Vous devez modifier au moins une information pour mettre a jour votre profil."
});

module.exports = { updateProfileSchema };