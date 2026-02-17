// src/validations/authValidation.js
// CONTRATS DE DONNÉES AUTH - Zod Strict
// CSCSM Level: Bank Grade

const { z } = require('zod');

/**
 * Liste noire des domaines d'emails jetables pour prévenir le spam et les faux comptes.
 */
const DISPOSABLE_DOMAINS = [
  'tempmail.com', '10minutemail.com', 'guerrillamail.com', 
  'yopmail.com', 'mailinator.com', 'throwaway.com'
];

/**
 * Schéma d'inscription (Register)
 * ✅ CORRECTIF : Ajout de la plage \u00C0-\u00FF pour autoriser les accents (é, à, è, etc.)
 */
const registerSchema = z.object({
  name: z.string()
    .min(2, 'Le nom doit contenir au moins 2 caractères')
    .max(50, 'Le nom ne peut dépasser 50 caractères')
    // Plage \u00C0-\u00FF ajoutée pour supporter les noms accentués francophones
    .regex(/^[a-zA-Z\u00C0-\u00FF\s'-]+$/, 'Caractères autorisés: lettres (accents inclus), espaces, - et \' uniquement')
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
}).strict(); // Protection contre le Mass Assignment

/**
 * Schéma de connexion (Login)
 */
const loginSchema = z.object({
  identifier: z.string()
    .min(3, 'Identifiant trop court')
    .max(254, 'Identifiant trop long')
    .trim(),
    
  password: z.string()
    .min(1, 'Le mot de passe est requis')
}).strict();

/**
 * Schéma de mise à jour de la disponibilité (Chauffeurs)
 */
const availabilitySchema = z.object({
  isAvailable: z.boolean({
    required_error: 'Statut de disponibilité requis',
    invalid_type_error: 'La valeur doit être true ou false'
  })
}).strict();

/**
 * Schéma de mise à jour du FCM Token (Notifications Push)
 */
const fcmTokenSchema = z.object({
  fcmToken: z.string()
    .min(10, 'Token FCM invalide ou trop court')
    .trim()
}).strict();

module.exports = {
  registerSchema,
  loginSchema,
  availabilitySchema,
  fcmTokenSchema
};