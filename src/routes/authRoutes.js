// src/routes/authRoutes.js
// ROUTES AUTH - Validation Zod & Rate Limiting
// CSCSM Level: Bank Grade

const express = require('express');
const router = express.Router();
const { z } = require('zod'); // Zod remplace Joi
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
// RATE LIMITING
// ═══════════════════════════════════════════════════════════

const createAuthLimiter = (maxAttempts, windowMinutes) => {
  return rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    max: maxAttempts,
    skipSuccessfulRequests: true,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json({
        success: false,
        message: `Trop de tentatives. Réessayez dans ${windowMinutes} minutes.`,
        code: 'RATE_LIMIT_EXCEEDED'
      });
    }
  });
};

const registerLimiter = createAuthLimiter(3, 60);
const loginLimiter = createAuthLimiter(5, 15);

// ═══════════════════════════════════════════════════════════
// SCHÉMAS ZOD
// ═══════════════════════════════════════════════════════════

const DISPOSABLE_DOMAINS = [
  'tempmail.com', '10minutemail.com', 'guerrillamail.com', 
  'yopmail.com', 'mailinator.com', 'throwaway.com'
];

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
});

const loginSchema = z.object({
  identifier: z.string()
    .min(3, 'Identifiant trop court')
    .max(254, 'Identifiant trop long')
    .trim(),
    
  password: z.string()
    .min(1, 'Le mot de passe est requis')
});

const availabilitySchema = z.object({
  isAvailable: z.boolean({
    required_error: 'Statut de disponibilité requis',
    invalid_type_error: 'La valeur doit être true ou false'
  })
});

// ═══════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════

router.post('/register', registerLimiter, validate(registerSchema), registerUser);
router.post('/login', loginLimiter, validate(loginSchema), loginUser);
router.post('/refresh', refreshToken);
router.post('/logout', optionalAuth, logoutUser);
router.put('/availability', protect, validate(availabilitySchema), updateAvailability);

module.exports = router;