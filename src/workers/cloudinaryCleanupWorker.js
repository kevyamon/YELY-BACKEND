// src/workers/cloudinaryCleanupWorker.js
// WORKER DE NETTOYAGE - Optimisation des coûts Cloudinary
// CSCSM Level: Bank Grade

const { Worker, Queue } = require('bullmq');
const cloudinary = require('../config/cloudinary');
const Transaction = require('../models/Transaction');
const logger = require('../config/logger');
const { env } = require('../config/env');

const RETENTION_DAYS = 30;

const startCloudinaryCleanupWorker = () => {
  // 1. Initialisation de la file d'attente (Cron Job)
  const cleanupQueue = new Queue('cloudinary-cleanup', { connection: { url: env.REDIS_URL } });
  
  // Planification : S'exécute tous les jours à 03h00 du matin
  cleanupQueue.add('purge-old-proofs', {}, { 
    repeat: { pattern: '0 3 * * *' },
    removeOnComplete: true
  });

  // 2. Définition du Worker
  const worker = new Worker(
    'cloudinary-cleanup',
    async (job) => {
      if (job.name === 'purge-old-proofs') {
        logger.info(`[WORKER] Début de la purge Cloudinary (Rétention: ${RETENTION_DAYS} jours)...`);
        
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);

        // Recherche des transactions terminées dont l'image est encore stockée
        const transactionsToClean = await Transaction.find({
          status: { $in: ['APPROVED', 'REJECTED'] },
          updatedAt: { $lt: cutoffDate },
          proofPublicId: { $ne: null } // Vérifie que l'image n'a pas déjà été supprimée
        });

        let deletedCount = 0;

        for (const tx of transactionsToClean) {
          try {
            // Suppression physique sur Cloudinary
            await cloudinary.uploader.destroy(tx.proofPublicId);
            
            // Mise à jour de la transaction (On garde la trace, on supprime le poids)
            tx.proofUrl = 'DELETED_FOR_STORAGE_OPTIMIZATION';
            tx.proofPublicId = null;
            tx.auditLog.push({
              action: 'SYSTEM_CLEANUP',
              note: `Image supprimée automatiquement des serveurs après ${RETENTION_DAYS} jours.`,
              timestamp: new Date()
            });
            
            await tx.save();
            deletedCount++;
          } catch (error) {
            logger.error(`[WORKER ERROR] Échec de suppression Cloudinary pour TX ${tx._id}: ${error.message}`);
          }
        }
        
        logger.info(`[WORKER] Purge Cloudinary terminée. ${deletedCount} images supprimées avec succès.`);
      }
    },
    {
      connection: { url: env.REDIS_URL },
      concurrency: 1 // Pas besoin de parallélisme massif pour un cron de nuit
    }
  );

  worker.on('failed', (job, err) => {
    logger.error(`[WORKER CRITICAL] Le job de nettoyage Cloudinary a échoué : ${err.message}`);
  });

  logger.info('Worker de nettoyage Cloudinary (Cron) actif et planifié.');
  return worker;
};

module.exports = startCloudinaryCleanupWorker;