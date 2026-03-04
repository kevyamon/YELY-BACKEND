// src/workers/cloudinaryCleanupWorker.js
// WORKER DE NETTOYAGE - Optimisation des coûts Cloudinary & RGPD
// CSCSM Level: Bank Grade

const { Worker, Queue } = require('bullmq');
const cloudinary = require('../config/cloudinary');
const Transaction = require('../models/Transaction');
const Report = require('../models/Report'); // AJOUT SENIOR: On importe le modèle des signalements
const logger = require('../config/logger');
const { env } = require('../config/env');

const RETENTION_DAYS_TRANSACTIONS = 30;
const RETENTION_DAYS_REPORTS = 30; // AJOUT SENIOR: Délai de sécurité avant Hard Delete

const startCloudinaryCleanupWorker = () => {
  // 1. Initialisation de la file d'attente (Cron Job)
  const cleanupQueue = new Queue('cloudinary-cleanup', { connection: { url: env.REDIS_URL } });
  
  // Planification 1 : S'exécute tous les jours à 03h00 du matin pour les transactions
  cleanupQueue.add('purge-old-proofs', {}, { 
    repeat: { pattern: '0 3 * * *' },
    removeOnComplete: true
  });

  // AJOUT SENIOR - Planification 2 : S'exécute tous les jours à 04h00 du matin pour les signalements
  cleanupQueue.add('purge-old-reports', {}, { 
    repeat: { pattern: '0 4 * * *' },
    removeOnComplete: true
  });

  // 2. Définition du Worker
  const worker = new Worker(
    'cloudinary-cleanup',
    async (job) => {
      
      // ---------------------------------------------------------
      // JOB 1 : NETTOYAGE DES PREUVES DE TRANSACTIONS (Soft Delete)
      // ---------------------------------------------------------
      if (job.name === 'purge-old-proofs') {
        logger.info(`[WORKER] Début de la purge Transactions Cloudinary (Rétention: ${RETENTION_DAYS_TRANSACTIONS} jours)...`);
        
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS_TRANSACTIONS);

        const transactionsToClean = await Transaction.find({
          status: { $in: ['APPROVED', 'REJECTED'] },
          updatedAt: { $lt: cutoffDate },
          proofPublicId: { $ne: null } 
        });

        let deletedCount = 0;

        for (const tx of transactionsToClean) {
          try {
            await cloudinary.uploader.destroy(tx.proofPublicId);
            
            tx.proofUrl = 'DELETED_FOR_STORAGE_OPTIMIZATION';
            tx.proofPublicId = null;
            tx.auditLog.push({
              action: 'SYSTEM_CLEANUP',
              note: `Image supprimée automatiquement des serveurs après ${RETENTION_DAYS_TRANSACTIONS} jours.`,
              timestamp: new Date()
            });
            
            await tx.save();
            deletedCount++;
          } catch (error) {
            logger.error(`[WORKER ERROR] Échec de suppression Cloudinary pour TX ${tx._id}: ${error.message}`);
          }
        }
        
        logger.info(`[WORKER] Purge Transactions terminée. ${deletedCount} images supprimées avec succès.`);
      }

      // ---------------------------------------------------------
      // JOB 2 : NETTOYAGE DES SIGNALEMENTS (Hard Delete Total)
      // ---------------------------------------------------------
      if (job.name === 'purge-old-reports') {
        logger.info(`[WORKER] Début du HARD DELETE des Signalements (Rétention: ${RETENTION_DAYS_REPORTS} jours)...`);
        
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS_REPORTS);

        // On ne cible QUE les signalements résolus
        const reportsToClean = await Report.find({
          status: 'RESOLVED',
          updatedAt: { $lt: cutoffDate }
        });

        let deletedReportsCount = 0;
        let deletedImagesCount = 0;

        for (const report of reportsToClean) {
          try {
            // 1. Destruction des images associées sur Cloudinary
            if (report.captures && report.captures.length > 0) {
              for (const url of report.captures) {
                const publicIdMatch = url.match(/\/v\d+\/([^/.]+)\./);
                if (publicIdMatch && publicIdMatch[1]) {
                   await cloudinary.uploader.destroy(`yely/reports/${publicIdMatch[1]}`).catch(() => {});
                   deletedImagesCount++;
                }
              }
            }
            
            // 2. Hard Delete en base de données
            await Report.findByIdAndDelete(report._id);
            deletedReportsCount++;
            
          } catch (error) {
            logger.error(`[WORKER ERROR] Échec du Hard Delete pour le Report ${report._id}: ${error.message}`);
          }
        }
        
        logger.info(`[WORKER] Hard Delete Signalements terminé. ${deletedReportsCount} plaintes et ${deletedImagesCount} images détruites.`);
      }

    },
    {
      connection: { url: env.REDIS_URL },
      concurrency: 1 
    }
  );

  worker.on('failed', (job, err) => {
    logger.error(`[WORKER CRITICAL] Le job ${job.name} a échoué : ${err.message}`);
  });

  logger.info('Worker de nettoyage Cloudinary (Cron) actif et planifié.');
  return worker;
};

module.exports = startCloudinaryCleanupWorker;