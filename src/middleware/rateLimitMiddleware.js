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
    prefix: 'global_api_rl:', 
  }),
  message: {
    status: 429,
    success: false,
    message: 'Trop de requêtes, veuillez réessayer plus tard.'
  }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: env.NODE_ENV === 'development' ? 100 : 20, // Tolérance à 20 requêtes pour protéger le réseau partagé (NAT)
  standardHeaders: true, 
  legacyHeaders: false,
  store: new RedisStore({
    sendCommand: (...args) => redisClient.call(...args),
    prefix: 'auth_api_rl:', 
  }),
  message: {
    status: 429,
    success: false,
    message: 'De nombreuses tentatives de connexion suspectes ont été détectées depuis votre réseau. Veuillez patienter 15 minutes.'
  }
});

module.exports = { apiLimiter, authLimiter };