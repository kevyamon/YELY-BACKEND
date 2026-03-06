// src/config/redis.js
// CONNEXION REDIS SINGLETON & PUB/SUB
// STANDARD: Industriel / Bank Grade

const Redis = require('ioredis');
const { env } = require('./env');
const logger = require('./logger');

let redisClient = null;

const getRedisClient = () => {
  if (!redisClient) {
    logger.info('[REDIS] Initialisation connexion Redis...');
    
    const redisUrl = env.REDIS_URL || 'redis://localhost:6379';

    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: null, // OBLIGATOIRE pour BullMQ
      enableReadyCheck: false,
      retryStrategy(times) {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    });

    redisClient.on('connect', () => {
      logger.info('[REDIS] Connexion principale etablie avec succes');
      
      // AUTO-CORRECTION: Tentative de forçage de la politique mémoire pour éviter les crashs
      redisClient.config('SET', 'maxmemory-policy', 'noeviction').catch((err) => {
        logger.warn(`[REDIS] Impossible de forcer "noeviction" (Normal sur les clouds gratuits). Pensez à vider le cache. Détail: ${err.message}`);
      });
    });

    redisClient.on('error', (err) => logger.error(`[REDIS] Erreur de connexion: ${err.message}`));

    // CREATION DES CLIENTS PUB/SUB POUR L'ADAPTATEUR SOCKET.IO
    redisClient.pubClient = redisClient.duplicate();
    redisClient.subClient = redisClient.duplicate();

    redisClient.pubClient.on('error', (err) => logger.error(`[REDIS PUB] Erreur: ${err.message}`));
    redisClient.subClient.on('error', (err) => logger.error(`[REDIS SUB] Erreur: ${err.message}`));
  }
  return redisClient;
};

module.exports = getRedisClient();