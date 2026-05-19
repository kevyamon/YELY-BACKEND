// src/workers/cloudinaryCleanupWorker.js
// WORKER DE NETTOYAGE - Optimisation des coûts Cloudinary & RGPD
// CSCSM Level: Bank Grade

const { Worker, Queue } = require('bullmq');
const cloudinary = require('../config/cloudinary');
const Transaction = require('../models/Transaction');
const Report = require('../models/Report'); // AJOUT SENIOR: On importe le modèle des signalements
const User = require('../models/User');
const Ride = require('../models/Ride');
const Order = require('../models/Order');
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

  // AJOUT SENIOR - Planification 3 : S'exécute tous les jours à 05h00 du matin pour la purge générale de la DB (Courses abandonnées, FCM inactifs, Comptes supprimés)
  cleanupQueue.add('purge-general-database', {}, { 
    repeat: { pattern: '0 5 * * *' },
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

      // ---------------------------------------------------------
      // JOB 3 : PURGE GÉNÉRALE DE LA DB (Courses abandonnées, FCM inactifs, Comptes supprimés)
      // ---------------------------------------------------------
      if (job.name === 'purge-general-database') {
        logger.info(`[WORKER] Début de la purge générale de la DB...`);
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - 30); // Seuil de 30 jours

        try {
          // A. Nettoyage FCM Tokens des utilisateurs inactifs (>30 jours)
          const fcmRes = await User.updateMany(
            { updatedAt: { $lt: cutoffDate }, fcmToken: { $ne: null } },
            { $set: { fcmToken: null } }
          );
          logger.info(`[WORKER] Purge FCM Tokens : ${fcmRes.modifiedCount} tokens expirés nettoyés.`);

          // B. Hard delete des comptes utilisateurs supprimés (soft delete >30 jours)
          const deletedUsers = await User.find({ isDeleted: true, updatedAt: { $lt: cutoffDate } });
          let userDeletedCount = 0;
          for (const user of deletedUsers) {
            try {
              // Nettoyage de l'image de profil sur Cloudinary
              if (user.profilePicture && user.profilePicture.includes('cloudinary')) {
                const match = user.profilePicture.match(/\/v\d+\/([^/.]+)\./);
                if (match && match[1]) {
                  await cloudinary.uploader.destroy(`yely/profiles/${match[1]}`).catch(() => {});
                }
              }
              // Nettoyage des documents administratifs (carte d'identité, permis, assurance)
              if (user.documents) {
                for (const docKey of ['idCard', 'license', 'insurance']) {
                  const url = user.documents[docKey];
                  if (url && url.includes('cloudinary')) {
                    const match = url.match(/\/v\d+\/([^/.]+)\./);
                    if (match && match[1]) {
                      await cloudinary.uploader.destroy(`yely/documents/${match[1]}`).catch(() => {});
                    }
                  }
                }
              }
              await User.findByIdAndDelete(user._id);
              userDeletedCount++;
            } catch (e) {
              logger.error(`[WORKER ERROR] Échec suppression complète utilisateur ${user._id}: ${e.message}`);
            }
          }
          logger.info(`[WORKER] Purge comptes soft-supprimés : ${userDeletedCount} utilisateurs retirés définitivement.`);

          // C. Double-sécurité : Suppression des courses abandonnées/annulées
          const ridesRes = await Ride.deleteMany({
            status: { $in: ['searching', 'negotiating', 'cancelled'] },
            createdAt: { $lt: cutoffDate }
          });
          logger.info(`[WORKER] Purge Courses abandonnées/annulées : ${ridesRes.deletedCount} documents supprimés.`);

          // D. Double-sécurité : Suppression des commandes rejetées/annulées
          const ordersRes = await Order.deleteMany({
            status: { $in: ['cancelled', 'cancelled_no_driver', 'rejected'] },
            createdAt: { $lt: cutoffDate }
          });
          logger.info(`[WORKER] Purge Commandes abandonnées : ${ordersRes.deletedCount} documents supprimés.`);
          
        } catch (error) {
          logger.error(`[WORKER CRITICAL ERROR] Échec de la purge générale de la DB : ${error.message}`);
        }
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