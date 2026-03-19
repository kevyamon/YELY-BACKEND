// src/workers/rideWorker.js
// WORKER DE NETTOYAGE - Surveillance des Timeouts et Extension de zone
// CSCSM Level: Bank Grade

const { Worker } = require('bullmq'); 
const rideLifecycleService = require('../services/ride/rideLifecycleService');
const logger = require('../config/logger');
const { env } = require('../config/env');
const Ride = require('../models/Ride'); 

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
          logger.info(`[WORKER] Liberation du chauffeur muet pour la course : ${rideId}`);
          await rideLifecycleService.releaseStuckNegotiations(io, rideId);
        } 
        else if (job.name === 'check-search-timeout') {
          const { rideId } = job.data;
          logger.info(`[WORKER] Fin definitive du temps de recherche pour la course : ${rideId}`);
          await rideLifecycleService.cancelSearchTimeout(io, rideId);
        }
      } catch (error) {
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
    logger.debug(`[WORKER] Job ${job.name} termine avec succes.`);
  });

  worker.on('failed', (job, err) => {
    logger.error(`[WORKER] Job ${job.name} a echoue en boucle : ${err.message}`);
  });

  logger.info('Worker de nettoyage et dispatch des courses actif');
  
  const purgeOldRides = async () => {
    try {
      logger.info('[CRON] Demarrage de la purge des courses abandonnees ou annulees (> 30 jours)...');
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      
      const result = await Ride.deleteMany({
        status: { $in: ['cancelled', 'searching'] },
        createdAt: { $lt: thirtyDaysAgo }
      });
      
      if (result.deletedCount > 0) {
        logger.info(`[CRON] Purge terminee : ${result.deletedCount} courses mortes supprimees.`);
      } else {
        logger.info('[CRON] Purge terminee : Aucune course morte a supprimer.');
      }
    } catch (error) {
      logger.error(`[CRON ERROR] Echec de la purge des courses : ${error.message}`);
    }
  };

  setTimeout(purgeOldRides, 10000);
  
  setInterval(purgeOldRides, 24 * 60 * 60 * 1000);

  return worker;
};

module.exports = startRideWorker;