// src/services/notificationService.js
const { Expo } = require('expo-server-sdk');
const User = require('../models/User');
const Notification = require('../models/Notification');
const logger = require('../config/logger');

const expo = new Expo();

/**
 * @desc Envoie une notification (Push + Persistance DB)
 */
exports.sendNotification = async (userId, title, body, type = 'GENERAL', data = {}) => {
  try {
    // 1. Enregistrement en base de données pour l'historique
    const newNotification = await Notification.create({
      recipient: userId,
      title,
      message: body,
      type,
      metadata: data
    });

    // 2. Récupération du token et envoi Push
    const user = await User.findById(userId).select('+fcmToken');
    if (user && user.fcmToken && Expo.isExpoPushToken(user.fcmToken)) {
      const messages = [{
        to: user.fcmToken,
        sound: 'default',
        title,
        body,
        data: { ...data, type, notificationId: newNotification._id },
        priority: 'high',
      }];

      const chunks = expo.chunkPushNotifications(messages);
      for (const chunk of chunks) {
        await expo.sendPushNotificationsAsync(chunk);
      }
      logger.info(`[PUSH] Notification envoyee a ${userId}`);
    }

    return newNotification;
  } catch (error) {
    logger.error(`[NOTIFICATION SERVICE] Erreur envoi: ${error.message}`);
  }
};

/**
 * @desc Recupere les notifications d'un utilisateur (Pagination)
 */
exports.getNotificationsForUser = async (userId, page = 1) => {
  const limit = 20;
  const skip = (page - 1) * limit;

  const notifications = await Notification.find({ recipient: userId })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  const total = await Notification.countDocuments({ recipient: userId });
  const unreadCount = await Notification.countDocuments({ recipient: userId, isRead: false });

  return {
    notifications,
    pagination: {
      total,
      unreadCount,
      page,
      pages: Math.ceil(total / limit)
    }
  };
};

/**
 * @desc Marquer une notification comme lue
 */
exports.markAsRead = async (userId, notificationId) => {
  return await Notification.findOneAndUpdate(
    { _id: notificationId, recipient: userId },
    { isRead: true },
    { new: true }
  );
};