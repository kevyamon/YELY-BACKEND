// src/workers/rideWorker.js
// WORKER DE NETTOYAGE - Libération automatique des négociations expirées
// CSCSM Level: Bank Grade

const { Worker } = require('bullmq'); // npm install bullmq
const rideService = require('../services/rideService');
const logger = require('../config/logger');
const { env } = require('../config/env');

/**
 * Création du Worker
 * Il surveille la file 'ride-cleanup' définie dans rideService.js
 */
const startRideWorker = (io) => {
  const worker = new Worker(
    'ride-cleanup',
    async (job) => {
      try {
        if (job.name === 'check-stuck-negotiation') {
          const { rideId } = job.data;
          
          logger.info(`[WORKER] Vérification de la course : ${rideId}`);
          
          // On appelle la fonction de nettoyage pour cette course spécifique
          // On passe l'instance 'io' pour notifier les utilisateurs par Socket.io
          await rideService.releaseStuckNegotiations(io, rideId);
        }
      } catch (error) {
        logger.error(`[WORKER ERROR] Job ${job.id} failed: ${error.message}`);
        throw error; // Permet à BullMQ de retenter le job si besoin
      }
    },
    {
      connection: { url: env.REDIS_URL },
      concurrency: 5, // Peut traiter 5 nettoyages en parallèle
      removeOnComplete: { count: 100 }, // Garde un historique des 100 derniers jobs
      removeOnFail: { count: 500 }
    }
  );

  worker.on('completed', (job) => {
    logger.debug(`[WORKER] Job ${job.id} terminé avec succès.`);
  });

  worker.on('failed', (job, err) => {
    logger.error(`[WORKER] Job ${job.id} a échoué : ${err.message}`);
  });

  logger.info('Worker de nettoyage des courses actif');
  
  return worker;
};

module.exports = startRideWorker;