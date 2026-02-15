// src/services/notificationService.js
// SERVICE DE NOTIFICATIONS PUSH - Réveil Driver
// CSCSM Level: Bank Grade

const admin = require('../config/firebase');
const User = require('../models/User');
const logger = require('../config/logger');

/**
 * 🚀 ENVOI DE NOTIFICATION PUSH
 * @param {string} userId - L'ID du destinataire
 * @param {string} title - Titre de la notif (ex: "Nouvelle Course !")
 * @param {string} body - Corps du texte
 * @param {object} data - Données invisibles pour le code front-end (ex: ID de la course)
 */
const sendPushNotification = async (userId, title, body, data = {}) => {
  try {
    // Si Firebase n'est pas configuré, on annule sans faire planter l'app
    if (!admin.apps || !admin.apps.length) return false; 

    // 1. Récupérer le token du destinataire
    const user = await User.findById(userId).select('fcmToken name');
    
    if (!user || !user.fcmToken) {
      logger.info(`[PUSH IGNORÉ] Aucun token FCM pour ${user ? user.name : userId}`);
      return false;
    }

    // 2. Préparer le missile (Priorité Haute obligatoire pour les apps de VTC/Livreurs)
    const message = {
      notification: { title, body },
      data: {
        ...data,
        click_action: 'FLUTTER_NOTIFICATION_CLICK' // Standard si tu utilises Flutter
      },
      token: user.fcmToken,
      android: {
        priority: 'high', // 🔥 LE SECRET EST ICI : Réveille le téléphone en veille
        notification: {
          sound: 'default',
          channelId: 'yely_rides' // À configurer aussi côté Front-end
        }
      }
    };

    // 3. Tir !
    const response = await admin.messaging().send(message);
    logger.info(`[PUSH SUCCÈS] Envoyé à ${user.name}: ${response}`);
    return true;

  } catch (error) {
    logger.error(`[PUSH ERREUR] Échec pour ${userId}: ${error.message}`);
    
    // Auto-nettoyage : Si l'app a été désinstallée, on supprime le token mort
    if (error.code === 'messaging/invalid-registration-token' || error.code === 'messaging/registration-token-not-registered') {
       await User.findByIdAndUpdate(userId, { fcmToken: null });
       logger.info(`[PUSH CLEANUP] Token mort supprimé pour ${userId}`);
    }
    return false;
  }
};

module.exports = {
  sendPushNotification
};