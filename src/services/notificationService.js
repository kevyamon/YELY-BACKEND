// src/services/notificationService.js
// SERVICE DE NOTIFICATIONS PUSH - React Native (Expo) Optimise
// CSCSM Level: Bank Grade

const admin = require('../config/firebase');
const User = require('../models/User');
const logger = require('../config/logger');

/**
 * ENVOI DE NOTIFICATION PUSH
 * @param {string} target - L'ID de l'utilisateur OU directement son token FCM
 * @param {string} title - Titre de la notif
 * @param {string} body - Corps du texte
 * @param {object} data - Donnees invisibles pour le routing React Navigation
 */
const sendPushNotification = async (target, title, body, data = {}) => {
  try {
    if (!admin.apps || !admin.apps.length) return false; 

    let fcmToken = target;
    let userId = null;

    // Detection automatique: Si ce n'est pas un token (qui est generalement long), c'est un ObjectId
    if (target && target.length < 50) {
      userId = target;
      const user = await User.findById(userId).select('fcmToken name');
      
      if (!user || !user.fcmToken) {
        logger.info(`[PUSH IGNORE] Aucun token FCM pour ${user ? user.name : userId}`);
        return false;
      }
      fcmToken = user.fcmToken;
    }

    // Configuration specifique pour React Native / Expo
    const message = {
      notification: { title, body },
      data: {
        ...data
      },
      token: fcmToken,
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          channelId: 'yely_rides'
        }
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            contentAvailable: true
          }
        }
      }
    };

    const response = await admin.messaging().send(message);
    logger.info(`[PUSH SUCCES] Envoye au token se terminant par ...${fcmToken.slice(-5)}: ${response}`);
    return true;

  } catch (error) {
    logger.error(`[PUSH ERREUR] Echec de l'envoi: ${error.message}`);
    
    if (error.code === 'messaging/invalid-registration-token' || error.code === 'messaging/registration-token-not-registered') {
       // Si on a l'ID utilisateur, on nettoie son profil
       if (target && target.length < 50) {
         await User.findByIdAndUpdate(target, { fcmToken: null });
         logger.info(`[PUSH CLEANUP] Token mort supprime pour l'utilisateur ${target}`);
       }
    }
    return false;
  }
};

module.exports = {
  sendPushNotification
};