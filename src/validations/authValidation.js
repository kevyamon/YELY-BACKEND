// src/validations/authValidation.js
// CONTRATS DE DONNÉES AUTH - Zod Strict
// CSCSM Level: Bank Grade

const { z } = require('zod');

const DISPOSABLE_DOMAINS = [
  'tempmail.com', '10minutemail.com', 'guerrillamail.com', 
  'yopmail.com', 'mailinator.com', 'throwaway.com'
];

/**
 * Schéma d'inscription
 * Inclus : Nettoyage auto, validation email non-jetable, complexité mot de passe
 */
const registerSchema = z.object({
  name: z.string()
    .min(2, 'Le nom doit contenir au moins 2 caractères')
    .max(50, 'Le nom ne peut dépasser 50 caractères')
    .regex(/^[a-zA-Z\s'-]+$/, 'Caractères autorisés: lettres, espaces, - et \' uniquement')
    .trim(),
    
  email: z.string()
    .email('Email invalide')
    .toLowerCase()
    .trim()
    .refine((email) => {
      const domain = email.split('@')[1];
      return !DISPOSABLE_DOMAINS.includes(domain);
    }, 'Les emails temporaires ne sont pas autorisés'),

  phone: z.string()
    .regex(/^\+?[0-9\s]{8,20}$/, 'Format invalide (+225 XX XX XX XX)')
    .trim(),

  password: z.string()
    .min(8, 'Mot de passe: 8 caractères minimum')
    .max(128, 'Mot de passe trop long')
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?])/, 
      '1 majuscule, 1 minuscule, 1 chiffre, 1 symbole requis'),

  role: z.enum(['rider', 'driver']).default('rider')
}).strict(); // Rejette tout champ non défini (Sécurité Mass Assignment)

const loginSchema = z.object({
  identifier: z.string()
    .min(3, 'Identifiant trop court')
    .max(254, 'Identifiant trop long')
    .trim(),
    
  password: z.string()
    .min(1, 'Le mot de passe est requis')
}).strict();

const availabilitySchema = z.object({
  isAvailable: z.boolean({
    required_error: 'Statut de disponibilité requis',
    invalid_type_error: 'La valeur doit être true ou false'
  })
}).strict();

module.exports = {
  registerSchema,
  loginSchema,
  availabilitySchema
};