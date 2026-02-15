// src/routes/authRoutes.js
// ROUTES AUTH - Validation & Rate Limiting
// CSCSM Level: Bank Grade

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { 
  registerUser, 
  loginUser, 
  logoutUser, 
  refreshToken,
  updateAvailability,
  updateFcmToken // ✅ AJOUT DE L'IMPORT
} = require('../controllers/authController');
const { protect, optionalAuth } = require('../middleware/authMiddleware');
const validate = require('../middleware/validationMiddleware');

// Import des schémas de validation centralisés
const { 
  registerSchema, 
  loginSchema, 
  availabilitySchema 
} = require('../validations/authValidation');

// ═══════════════════════════════════════════════════════════
// RATE LIMITING SPÉCIFIQUE
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

const registerLimiter = createAuthLimiter(3, 60); // 3 essais par heure
const loginLimiter = createAuthLimiter(5, 15);    // 5 essais par 15 min

// ═══════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════

// Public
router.post('/register', registerLimiter, validate(registerSchema), registerUser);
router.post('/login', loginLimiter, validate(loginSchema), loginUser);
router.post('/refresh', refreshToken);
router.post('/logout', optionalAuth, logoutUser);

// Privé
router.put('/availability', protect, validate(availabilitySchema), updateAvailability);
router.put('/fcm-token', protect, updateFcmToken); // ✅ AJOUT DE LA ROUTE PRIVÉE

module.exports = router;