// src/middleware/rateLimitMiddleware.js
// PROTECTION ANTI-BRUTEFORCE & DOS (Redis Store Distributed)
// CSCSM Level: Bank Grade

const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis').default || require('rate-limit-redis');
const redisClient = require('../config/redis');
const { env } = require('../config/env');

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: env.NODE_ENV === 'development' ? 5000 : 1500, 
  standardHeaders: true, 
  legacyHeaders: false,
  store: new RedisStore({
    sendCommand: (...args) => redisClient.call(...args),
    // ISOLATION CRITIQUE : Ce prefixe evite que les requetes API de base 
    // ne consomment le quota des routes sensibles (comme le login).
    prefix: 'global_api_rl:', 
  }),
  message: {
    status: 429,
    success: false,
    message: 'Trop de requêtes, veuillez réessayer plus tard.'
  }
});

module.exports = { apiLimiter };