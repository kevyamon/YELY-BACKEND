// src/middleware/rateLimitMiddleware.js
// PROTECTION ANTI-BRUTEFORCE & DOS
// ☢️ ÉTAT ACTUEL : DÉSACTIVÉ POUR LE DÉBOGAGE ET LE DÉVELOPPEMENT INTENSIF

const rateLimit = require('express-rate-limit');

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // Réduit à 1 minute
  max: 100000, // Limite absurde (100 000 requêtes)
  standardHeaders: true, 
  legacyHeaders: false, 
  skip: (req, res) => true, // <-- L'OPTION NUCLÉAIRE : On ignore le limiteur à 100%
  message: {
    status: 429,
    success: false,
    message: 'Trop de requêtes, veuillez réessayer plus tard.'
  }
});

module.exports = { apiLimiter };