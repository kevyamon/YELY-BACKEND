// src/config/redis.js
// CONNEXION REDIS SINGLETON
// CSCSM Level: Bank Grade

const Redis = require('ioredis');
const { env } = require('./env'); // Assure-toi que env.js existe bien ici
const logger = require('./logger');

let redisClient = null;

const getRedisClient = () => {
  if (!redisClient) {
    logger.info('🔌 Initialisation connexion Redis...');
    
    // On utilise l'URL du .env s'il existe, sinon localhost par défaut pour le dev local
    const redisUrl = env.REDIS_URL || 'redis://localhost:6379';

    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: null, // OBLIGATOIRE pour BullMQ
      enableReadyCheck: false,
      retryStrategy(times) {
        // Stratégie de reconnexion intelligente (backoff exponentiel)
        // Si ça coupe, on attend un peu plus à chaque fois (max 2 secondes)
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    });

    redisClient.on('connect', () => logger.info('✅ Redis connecté avec succès'));
    redisClient.on('error', (err) => logger.error(`❌ Erreur Redis: ${err.message}`));
  }
  return redisClient;
};

// On exporte l'instance directement
module.exports = getRedisClient();