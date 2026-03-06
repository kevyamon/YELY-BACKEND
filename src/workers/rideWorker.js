// src/workers/rideWorker.js
// WORKER DE NETTOYAGE - Surveillance des Timeouts et Extension de zone
// CSCSM Level: Bank Grade

const { Worker } = require('bullmq'); 
// CORRECTION CRITIQUE : Import direct du service de cycle de vie (bypasse la facade globale)
const rideLifecycleService = require('../services/ride/rideLifecycleService');
const logger = require('../config/logger');
const { env } = require('../config/env');

const startRideWorker = (io) => {
  const worker = new Worker(
    'ride-cleanup',
    async (job) => {
      try {
        if (job.name === 'expand-search') {
          const { rideId } = job.data;
          logger.info(`[WORKER] Verification et agrandissement du rayon pour : ${rideId}`);
          await rideLifecycleService.expandSearchRadius(io, rideId);
        }
        else if (job.name === 'check-stuck-negotiation') {
          const { rideId } = job.data;
          logger.info(`[WORKER] Libération du chauffeur muet pour la course : ${rideId}`);
          await rideLifecycleService.releaseStuckNegotiations(io, rideId);
        } 
        else if (job.name === 'check-search-timeout') {
          const { rideId } = job.data;
          logger.info(`[WORKER] Fin definitive du temps de recherche pour la course : ${rideId}`);
          await rideLifecycleService.cancelSearchTimeout(io, rideId);
        }
      } catch (error) {
        // C'est ici que l'erreur silencieuse se produisait en arriere-plan
        logger.error(`[WORKER ERROR] Job ${job.name} a echoue : ${error.message}`);
        throw error; 
      }
    },
    {
      connection: { url: env.REDIS_URL },
      concurrency: 5, 
      removeOnComplete: { count: 100 }, 
      removeOnFail: { count: 500 }
    }
  );

  worker.on('completed', (job) => {
    logger.debug(`[WORKER] Job ${job.name} terminé avec succès.`);
  });

  worker.on('failed', (job, err) => {
    logger.error(`[WORKER] Job ${job.name} a échoué en boucle : ${err.message}`);
  });

  logger.info('Worker de nettoyage et dispatch des courses actif');
  
  return worker;
};

module.exports = startRideWorker;