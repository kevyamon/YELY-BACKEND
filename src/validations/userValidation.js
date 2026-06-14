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

const updatePasswordSchema = z.object({
  currentPassword: z.string()
    .min(1, 'Le mot de passe actuel est requis.'),
  newPassword: z.string()
    .min(8, 'Le nouveau mot de passe doit faire au moins 8 caracteres.')
    .max(128, 'Le nouveau mot de passe est trop long.')
    .refine(val => /[0-9]/.test(val) && /[a-zA-Z]/.test(val), {
      message: 'Le nouveau mot de passe doit contenir au moins une lettre et un chiffre.'
    })
}).strict();

module.exports = { updateProfileSchema, updatePasswordSchema };