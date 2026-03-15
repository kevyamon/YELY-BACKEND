// src/routes/authRoutes.js
// ROUTES AUTH - Validation Zod Async & Rate Limiting Hybride (IP + Identifiant)
// CSCSM Level: Bank Grade

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis').default || require('rate-limit-redis');
const redisClient = require('../config/redis');

const { 
  registerUser, 
  loginUser, 
  logoutUser, 
  forgotPassword,
  resetPassword,
  refreshToken,
  updateAvailability,
  updateFcmToken 
} = require('../controllers/authController');
const { protect, optionalAuth } = require('../middleware/authMiddleware');
const validate = require('../middleware/validationMiddleware');
const { authLimiter } = require('../middleware/rateLimitMiddleware'); // Ajout du bouclier IP global

const { 
  registerSchema, 
  loginSchema, 
  availabilitySchema,
  forgotPasswordSchema,
  resetPasswordSchema
} = require('../validations/authValidation');

// RATE LIMITING SPECIFIQUE (Connecte a Redis avec isolation des prefixes et ciblage par identifiant)
const createAuthLimiter = (maxAttempts, windowMinutes, customPrefix) => {
  return rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    max: maxAttempts,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      // On cible l'identifiant (email ou telephone) au lieu de l'adresse IP.
      // Cela permet a plusieurs telephones sur le meme partage de connexion d'avoir leurs propres compteurs.
      const identity = req.body.identifier || req.body.email || req.body.phone;
      return identity ? String(identity).toLowerCase().trim() : req.ip;
    },
    store: new RedisStore({
      sendCommand: (...args) => redisClient.call(...args),
      prefix: customPrefix || 'auth_rl:', 
    }),
    handler: (req, res) => {
      res.status(429).json({
        success: false,
        message: `Trop de tentatives. Reessayez dans ${windowMinutes} minutes.`,
        code: 'RATE_LIMIT_EXCEEDED'
      });
    }
  });
};

// Application de limites intelligentes avec des prefixes uniques
const registerLimiter = createAuthLimiter(3, 60, 'rl_register:'); 
const loginLimiter = createAuthLimiter(5, 15, 'rl_login:');    
const forgotPasswordLimiter = createAuthLimiter(3, 60, 'rl_forgot:'); 

// ROUTES (Double bouclier : authLimiter protège l'IP, tes limiters protègent l'identifiant)
router.post('/register', authLimiter, registerLimiter, validate(registerSchema), registerUser);
router.post('/login', authLimiter, loginLimiter, validate(loginSchema), loginUser);

router.post('/forgot-password', authLimiter, forgotPasswordLimiter, validate(forgotPasswordSchema), forgotPassword);
router.post('/reset-password', authLimiter, validate(resetPasswordSchema), resetPassword);

router.post('/refresh', refreshToken);
router.post('/logout', optionalAuth, logoutUser);

router.put('/availability', protect, validate(availabilitySchema), updateAvailability);
router.put('/fcm-token', protect, updateFcmToken);

module.exports = router;