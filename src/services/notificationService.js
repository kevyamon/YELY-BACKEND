// src/services/notificationService.js
const admin = require('../config/firebase');
const User = require('../models/User');
const Notification = require('../models/Notification');
const logger = require('../config/logger');

/**
 * @desc Envoie une notification (Push Firebase + Persistance DB)
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

    // 2. Récupération du token et envoi Push via Firebase
    const user = await User.findById(userId).select('+fcmToken');
    
    if (user && user.fcmToken) {
      const message = {
        notification: {
          title: title,
          body: body,
        },
        data: {
          ...data,
          type,
          notificationId: newNotification._id.toString(),
          click_action: 'FLUTTER_NOTIFICATION_CLICK', // Standard pour le mobile
        },
        token: user.fcmToken,
      };

      await admin.messaging().send(message);
      logger.info(`[PUSH FIREBASE] Notification envoyee a ${userId}`);
    } else {
      logger.warn(`[PUSH] Aucun token Firebase valide pour ${userId}, persistance DB seule.`);
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