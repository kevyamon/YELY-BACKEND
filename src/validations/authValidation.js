// src/validations/authValidation.js
// CONTRATS DE DONNEES AUTH - Zod Strict
// CSCSM Level: Bank Grade

const { z } = require('zod');

const DISPOSABLE_DOMAINS = [
  'tempmail.com', '10minutemail.com', 'guerrillamail.com', 
  'yopmail.com', 'mailinator.com', 'throwaway.com'
];

const registerSchema = z.object({
  name: z.string()
    .min(2, 'Votre nom doit contenir au moins 2 lettres.')
    .max(50, 'Votre nom est un peu trop long (maximum 50 caracteres).')
    .regex(/^[a-zA-Z\u00C0-\u00FF\s'-]+$/, 'Votre nom ne doit contenir ni chiffres ni caracteres speciaux.')
    .trim(),
    
  email: z.string()
    .email('Veuillez fournir une adresse e-mail valide.')
    .toLowerCase()
    .trim()
    .refine((email) => {
      const domain = email.split('@')[1];
      return !DISPOSABLE_DOMAINS.includes(domain);
    }, 'Les adresses e-mail temporaires ne sont pas autorisees.'),

  phone: z.string()
    .regex(/^\+?[0-9\s]{8,20}$/, 'Veuillez fournir un numero de telephone valide.')
    .trim(),

  password: z.string()
    .min(8, 'Votre mot de passe doit faire au moins 8 caracteres.')
    .max(128, 'Votre mot de passe est trop long.')
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?])/, 
      'Pour votre securite, le mot de passe doit inclure une majuscule, un chiffre et un symbole.'),

  role: z.enum(['rider', 'driver']).default('rider')
}).strict();

const loginSchema = z.object({
  identifier: z.string()
    .min(3, 'L\'identifiant est trop court.')
    .max(254, 'L\'identifiant est trop long.')
    .trim(),
    
  password: z.string()
    .min(1, 'Le mot de passe est requis.'),
    
  clientPlatform: z.string().optional()
}).strict();

// CORRECTION : Retrait de .strict() pour eviter que le serveur bloque
// les petites metadonnees invisibles ajoutees par React Native/Redux
const availabilitySchema = z.object({
  isAvailable: z.boolean({
    required_error: 'Le statut de disponibilite est requis.',
    invalid_type_error: 'La valeur fournie est invalide.'
  })
});

const forgotPasswordSchema = z.object({
  email: z.string()
    .email('Veuillez fournir une adresse e-mail valide.')
    .toLowerCase()
    .trim()
}).strict();

const resetPasswordSchema = z.object({
  email: z.string()
    .email('Veuillez fournir une adresse e-mail valide.')
    .toLowerCase()
    .trim(),
    
  otp: z.string()
    .length(6, 'Le code de securite doit contenir exactement 6 chiffres.')
    .regex(/^\d+$/, 'Le code ne doit contenir que des chiffres.'),
    
  newPassword: z.string()
    .min(8, 'Le nouveau mot de passe doit faire au moins 8 caracteres.')
    .max(128, 'Le nouveau mot de passe est trop long.')
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?])/, 
      'Pour votre securite, le mot de passe doit inclure une majuscule, un chiffre et un symbole.')
}).strict();

module.exports = {
  registerSchema,
  loginSchema,
  availabilitySchema,
  forgotPasswordSchema,
  resetPasswordSchema
};