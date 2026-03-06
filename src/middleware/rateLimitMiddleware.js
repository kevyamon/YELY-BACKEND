// src/middleware/rateLimitMiddleware.js
// PROTECTION ANTI-BRUTEFORCE & DOS
// CSCSM Level: Bank Grade (BOUCLIER RÉACTIVÉ)

const rateLimit = require('express-rate-limit');
const { env } = require('../config/env');

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // Fenêtre de 15 minutes
  // 5000 requêtes en dev pour tes tests, 1500 en prod pour bloquer les attaques
  max: env.NODE_ENV === 'development' ? 5000 : 1500, 
  standardHeaders: true, 
  legacyHeaders: false, 
  // skip: (req, res) => true, // <-- OPTION NUCLÉAIRE SUPPRIMÉE. LE BOUCLIER EST ACTIF.
  message: {
    status: 429,
    success: false,
    message: 'Trop de requêtes, veuillez réessayer plus tard.'
  }
});

module.exports = { apiLimiter };