// src/routes/authRoutes.js
// ROUTES AUTH - Validation & Rate Limiting (Redis Distributed)
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

const { 
  registerSchema, 
  loginSchema, 
  availabilitySchema,
  forgotPasswordSchema,
  resetPasswordSchema
} = require('../validations/authValidation');

// RATE LIMITING SPÉCIFIQUE (Connecté à Redis avec isolation des préfixes)
const createAuthLimiter = (maxAttempts, windowMinutes, customPrefix) => {
  return rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    max: maxAttempts,
    standardHeaders: true,
    legacyHeaders: false,
    store: new RedisStore({
      sendCommand: (...args) => redisClient.call(...args),
      // ISOLATION CRITIQUE : Chaque action (login, register) a son propre compteur indépendant
      prefix: customPrefix || 'auth_rl:', 
    }),
    handler: (req, res) => {
      res.status(429).json({
        success: false,
        message: `Trop de tentatives. Réessayez dans ${windowMinutes} minutes.`,
        code: 'RATE_LIMIT_EXCEEDED'
      });
    }
  });
};

// Application de limites intelligentes avec des préfixes uniques
const registerLimiter = createAuthLimiter(3, 60, 'rl_register:'); 
const loginLimiter = createAuthLimiter(5, 15, 'rl_login:');    
const forgotPasswordLimiter = createAuthLimiter(3, 60, 'rl_forgot:'); 

// ROUTES
router.post('/register', registerLimiter, validate(registerSchema), registerUser);
router.post('/login', loginLimiter, validate(loginSchema), loginUser);

router.post('/forgot-password', forgotPasswordLimiter, validate(forgotPasswordSchema), forgotPassword);
router.post('/reset-password', validate(resetPasswordSchema), resetPassword);

router.post('/refresh', refreshToken);
router.post('/logout', optionalAuth, logoutUser);

router.put('/availability', protect, validate(availabilitySchema), updateAvailability);
router.put('/fcm-token', protect, updateFcmToken);

module.exports = router;