// src/config/redis.js
// CONNEXION REDIS SINGLETON & PUB/SUB
// STANDARD: Industriel / Bank Grade

const Redis = require('ioredis');
const { env } = require('./env');
const logger = require('./logger');

// SILENCIEUX GLOBAL: Interception des avertissements intempestifs de la librairie de Workers
// Ces messages spamment les logs car les fournisseurs Cloud (Render, Upstash) verrouillent la configuration d'eviction.
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;

console.log = function (...args) {
  if (typeof args[0] === 'string' && args[0].includes('Eviction policy is')) return;
  originalConsoleLog.apply(console, args);
};

console.warn = function (...args) {
  if (typeof args[0] === 'string' && args[0].includes('Eviction policy is')) return;
  originalConsoleWarn.apply(console, args);
};

let redisClient = null;

const getRedisClient = () => {
  if (!redisClient) {
    logger.info('[REDIS] Initialisation connexion Redis...');
    
    const redisUrl = env.REDIS_URL || 'redis://localhost:6379';

    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: null, 
      enableReadyCheck: false,
      retryStrategy(times) {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    });

    redisClient.on('connect', () => {
      logger.info('[REDIS] Connexion principale etablie avec succes');
      // La tentative de modification de maxmemory-policy a ete retiree ici pour eviter l'erreur "Unsupported CONFIG parameter".
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