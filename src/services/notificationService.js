// src/services/notificationService.js
const { Expo } = require('expo-server-sdk');
const User = require('../models/User');
const logger = require('../config/logger');

const expo = new Expo();

/**
 * @desc Envoie une notification push à un utilisateur via son ID
 * @param {string} userId ID de l'utilisateur
 * @param {string} title Titre
 * @param {string} body Message
 * @param {object} data Données supplémentaires pour la navigation
 */
exports.sendNotification = async (userId, title, body, type = 'GENERAL', data = {}) => {
  try {
    const user = await User.findById(userId).select('+fcmToken');
    if (!user || !user.fcmToken) {
      logger.warn(`[PUSH] Aucun token trouvé pour l'utilisateur ${userId}`);
      return;
    }

    if (!Expo.isExpoPushToken(user.fcmToken)) {
      logger.error(`[PUSH] Token invalide pour ${userId}: ${user.fcmToken}`);
      return;
    }

    const messages = [{
      to: user.fcmToken,
      sound: 'default',
      title: title,
      body: body,
      data: { ...data, type },
      priority: 'high',
    }];

    const chunks = expo.chunkPushNotifications(messages);
    for (const chunk of chunks) {
      await expo.sendPushNotificationsAsync(chunk);
    }
    
    logger.info(`[PUSH] Notif envoyée à ${userId}: ${title}`);
  } catch (error) {
    logger.error(`[PUSH] Erreur envoi à ${userId}: ${error.message}`);
  }
};