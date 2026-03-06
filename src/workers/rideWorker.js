// src/workers/rideWorker.js
// WORKER DE NETTOYAGE - Surveillance des Timeouts et Extension de zone
// CSCSM Level: Bank Grade

const { Worker } = require('bullmq'); 
const rideService = require('../services/rideService');
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
          await rideService.expandSearchRadius(io, rideId);
        }
        else if (job.name === 'check-stuck-negotiation') {
          // Si le chauffeur a verrouillé la course mais n'a rien cliqué après 60s
          const { rideId } = job.data;
          logger.info(`[WORKER] Libération du chauffeur muet pour la course : ${rideId}`);
          await rideService.releaseStuckNegotiations(io, rideId);
        } 
        else if (job.name === 'check-search-timeout') {
          // Fin du temps de recherche après l'atteinte du rayon maximum
          const { rideId } = job.data;
          logger.info(`[WORKER] Fin definitive du temps de recherche pour la course : ${rideId}`);
          await rideService.cancelSearchTimeout(io, rideId);
        }
      } catch (error) {
        logger.error(`[WORKER ERROR] Job ${job.id} failed: ${error.message}`);
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
    logger.error(`[WORKER] Job ${job.name} a échoué : ${err.message}`);
  });

  logger.info('Worker de nettoyage et dispatch des courses actif');
  
  return worker;
};

module.exports = startRideWorker;