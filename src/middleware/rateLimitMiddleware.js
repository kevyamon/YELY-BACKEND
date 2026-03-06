// src/middleware/rateLimitMiddleware.js
// PROTECTION ANTI-BRUTEFORCE & DOS
// CSCSM Level: Bank Grade

const rateLimit = require('express-rate-limit');
const { env } = require('../config/env');

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  // En dev, on laisse 5000 requêtes. En prod, on met un standard industriel (ex: 2500)
  max: env.NODE_ENV === 'development' ? 5000 : 2500, 
  standardHeaders: true, 
  legacyHeaders: false, 
  message: {
    status: 429,
    success: false,
    message: 'Trop de requêtes, veuillez réessayer plus tard.'
  }
});

module.exports = { apiLimiter };