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

const registerLimiter = createAuthLimiter(3, 60); 
const loginLimiter = createAuthLimiter(5, 15);    

// RETOUR EN PROD: Limiteur strict rétabli à 3 demandes par heure max
const forgotPasswordLimiter = createAuthLimiter(3, 60); 

// ═══════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════

router.post('/register', registerLimiter, validate(registerSchema), registerUser);
router.post('/login', loginLimiter, validate(loginSchema), loginUser);

router.post('/forgot-password', forgotPasswordLimiter, validate(forgotPasswordSchema), forgotPassword);
router.post('/reset-password', validate(resetPasswordSchema), resetPassword);

router.post('/refresh', refreshToken);
router.post('/logout', optionalAuth, logoutUser);

router.put('/availability', protect, validate(availabilitySchema), updateAvailability);
router.put('/fcm-token', protect, updateFcmToken);

module.exports = router;