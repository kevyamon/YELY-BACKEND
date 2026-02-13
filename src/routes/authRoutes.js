// src/routes/authRoutes.js
// ROUTES AUTH - Rate Limiting Intelligent, Validation Joi Renforcée
// CSCSM Level: Bank Grade

const express = require('express');
const router = express.Router();
const Joi = require('joi');
const rateLimit = require('express-rate-limit');
const { 
  registerUser, 
  loginUser, 
  logoutUser, 
  refreshToken,
  updateAvailability 
} = require('../controllers/authController');
const { protect, optionalAuth } = require('../middleware/authMiddleware');
const validate = require('../middleware/validationMiddleware');

// ═══════════════════════════════════════════════════════════
// RATE LIMITING (Anti-Brute Force) - Version compatible IPv6
// ═══════════════════════════════════════════════════════════

const createAuthLimiter = (maxAttempts, windowMinutes) => {
  return rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    max: maxAttempts,
    skipSuccessfulRequests: true, // Les succès ne comptent pas
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      console.warn(`[SECURITY] Rate limit dépassé - IP: ${req.ip}, Route: ${req.originalUrl}`);
      res.status(429).json({
        success: false,
        message: `Trop de tentatives. Réessayez dans ${windowMinutes} minutes.`,
        retryAfter: windowMinutes * 60,
        code: 'RATE_LIMIT_EXCEEDED'
      });
    }
  });
};

// Limites spécifiques par endpoint
const registerLimiter = createAuthLimiter(3, 60);   // 3 inscriptions/heure/IP
const loginLimiter = createAuthLimiter(5, 15);      // 5 logins/15min/IP

// ═══════════════════════════════════════════════════════════
// OPTIONS JOI SÉCURISÉES
// ═══════════════════════════════════════════════════════════

const joiOptions = {
  abortEarly: false,
  stripUnknown: true,
  convert: false,
  errors: {
    wrap: { label: false }
  }
};

// ═══════════════════════════════════════════════════════════
// SCHÉMAS DE VALIDATION FORTERESSE
// ═══════════════════════════════════════════════════════════

// Liste domaines temporaires
const DISPOSABLE_DOMAINS = [
  'tempmail.com', '10minutemail.com', 'guerrillamail.com', 
  'yopmail.com', 'mailinator.com', 'throwaway.com'
];

const registerSchema = Joi.object({
  name: Joi.string()
    .trim()
    .min(2)
    .max(50)
    .pattern(/^[a-zA-Z\s'-]+$/)
    .required()
    .messages({
      'string.empty': 'Le nom est obligatoire.',
      'string.min': 'Le nom doit contenir au moins 2 caractères.',
      'string.max': 'Le nom ne peut dépasser 50 caractères.',
      'string.pattern.base': 'Caractères autorisés: lettres, espaces, - et \' uniquement.'
    }),

  email: Joi.string()
    .trim()
    .lowercase()
    .max(254)
    .email({ minDomainSegments: 2 })
    .pattern(/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/)
    .custom((value, helpers) => {
      const domain = value.split('@')[1];
      if (DISPOSABLE_DOMAINS.includes(domain)) {
        return helpers.error('email.disposable');
      }
      return value;
    })
    .required()
    .messages({
      'string.empty': 'L\'email est obligatoire.',
      'string.email': 'Format d\'email invalide.',
      'string.max': 'Email trop long.',
      'string.pattern.base': 'Format email invalide.',
      'email.disposable': 'Les emails temporaires ne sont pas autorisés.'
    }),

  phone: Joi.string()
    .trim()
    .pattern(/^\+?[0-9\s]{8,20}$/)
    .required()
    .messages({
      'string.empty': 'Le numéro de téléphone est obligatoire.',
      'string.pattern.base': 'Format invalide. Utilisez +225 XX XX XX XX ou format local.'
    }),

  password: Joi.string()
    .min(8)
    .max(128)
    .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?])/)
    .required()
    .messages({
      'string.empty': 'Le mot de passe est obligatoire.',
      'string.min': 'Mot de passe: 8 caractères minimum.',
      'string.max': 'Mot de passe trop long (max 128).',
      'string.pattern.base': 'Mot de passe trop faible: 1 majuscule, 1 minuscule, 1 chiffre, 1 symbole requis.'
    }),

  role: Joi.string()
    .valid('rider', 'driver')
    .default('rider')
    .messages({
      'any.only': 'Rôle invalide. Choisissez rider ou driver.'
    })

}).options(joiOptions);

const loginSchema = Joi.object({
  identifier: Joi.string()
    .trim()
    .min(3)
    .max(254)
    .required()
    .messages({
      'string.empty': 'L\'email ou téléphone est requis.',
      'string.min': 'Identifiant trop court.',
      'string.max': 'Identifiant trop long.'
    }),

  password: Joi.string()
    .min(1)
    .max(128)
    .required()
    .messages({
      'string.empty': 'Le mot de passe est requis.',
      'string.max': 'Mot de passe trop long.'
    })

}).options(joiOptions);

const availabilitySchema = Joi.object({
  isAvailable: Joi.boolean()
    .strict()
    .required()
    .messages({
      'boolean.base': 'La valeur doit être true ou false.',
      'any.required': 'Statut de disponibilité requis.'
    })
}).options(joiOptions);

// ═══════════════════════════════════════════════════════════
// ROUTES (BLINDÉES CSCSM)
// ═══════════════════════════════════════════════════════════

// Inscription: Rate limit + Validation stricte
router.post('/register', registerLimiter, validate(registerSchema), registerUser);

// Connexion: Rate limit + Validation
router.post('/login', loginLimiter, validate(loginSchema), loginUser);

// Rafraîchissement token (rotation)
router.post('/refresh', refreshToken);

// Déconnexion: Optionnel (nettoie même si token expiré)
router.post('/logout', optionalAuth, logoutUser);

// Mise à jour disponibilité: Auth requise + Validation
router.put('/availability', protect, validate(availabilitySchema), updateAvailability);

module.exports = router;