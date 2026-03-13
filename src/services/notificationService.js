// src/services/notificationService.js
// SERVICE NOTIFICATIONS - Orchestration Push & In-App
// CSCSM Level: Bank Grade

const admin = require('firebase-admin');
const Notification = require('../models/Notification');
const User = require('../models/User');
const logger = require('../config/logger');

const sendNotification = async (userId, title, message, type = 'SYSTEM', metadata = {}) => {
  try {
    // 1. Sauvegarde In-App (Toujours effectuee)
    const inAppNotif = await Notification.create({
      recipient: userId,
      title,
      message,
      type,
      metadata
    });

    // 2. Tentative d'envoi Push (si le token FCM existe)
    const user = await User.findById(userId).select('+fcmToken');
    if (user && user.fcmToken) {
      
      // PARSEUR DE SECURITE : Firebase Admin SDK exige que le payload "data" 
      // ne contienne strictement QUE des chaines de caracteres (Strings).
      const safeData = {
        notificationId: inAppNotif._id.toString(),
        type: String(type)
      };

      if (metadata && typeof metadata === 'object') {
        Object.keys(metadata).forEach(key => {
          if (metadata[key] !== null && metadata[key] !== undefined) {
            safeData[key] = String(metadata[key]);
          }
        });
      }
      
      const payload = {
        notification: { 
          title: String(title), 
          body: String(message) 
        },
        data: safeData,
        android: {
          priority: 'high',
          notification: {
            channelId: 'yely_rides',
            sound: 'default',
            defaultVibrateTimings: true,
            notificationPriority: 'PRIORITY_HIGH'
          }
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1,
              contentAvailable: true 
            }
          }
        },
        token: user.fcmToken
      };

      await admin.messaging().send(payload).catch(err => {
        logger.warn(`[PUSH] Echec d'envoi a ${userId}: ${err.message}`);
      });
    }

    return inAppNotif;
  } catch (error) {
    logger.error(`[NOTIF SERVICE] Erreur critique: ${error.message}`);
    return null;
  }
};

const getNotificationsForUser = async (userId, page = 1, limit = 20) => {
  const skip = (page - 1) * limit;
  const notifications = await Notification.find({ recipient: userId })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  const total = await Notification.countDocuments({ recipient: userId });
  const unreadCount = await Notification.countDocuments({ recipient: userId, isRead: false });

  return { notifications, pagination: { page, total, pages: Math.ceil(total / limit), unreadCount } };
};

const markAsRead = async (userId, notificationId) => {
  if (notificationId === 'all') {
    return await Notification.updateMany({ recipient: userId, isRead: false }, { isRead: true });
  }
  return await Notification.findOneAndUpdate(
    { _id: notificationId, recipient: userId },
    { isRead: true },
    { new: true }
  );
};

module.exports = {
  sendNotification,
  getNotificationsForUser,
  markAsRead
};