// src/controllers/notificationController.js
const notificationService = require('../services/notificationService');
const Notification = require('../models/Notification'); // Import nécessaire pour le delete
const { successResponse, errorResponse } = require('../utils/responseHandler');

const getNotifications = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const result = await notificationService.getNotificationsForUser(req.user._id, page);
    return successResponse(res, result, 'Notifications récupérées');
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

const markRead = async (req, res) => {
  try {
    await notificationService.markAsRead(req.user._id, req.params.id);
    return successResponse(res, null, 'Statut mis à jour');
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

// 🚀 AJOUT SENIOR : Suppression d'une ou de toutes les notifications
const deleteNotification = async (req, res) => {
  try {
    const notifId = req.params.id;
    
    if (notifId === 'all') {
      await Notification.deleteMany({ user: req.user._id });
      return successResponse(res, null, 'Toutes les notifications ont été supprimées.');
    }

    const notif = await Notification.findOne({ _id: notifId, user: req.user._id });
    if (!notif) return errorResponse(res, "Notification introuvable.", 404);

    await Notification.findByIdAndDelete(notifId);
    return successResponse(res, null, 'Notification supprimée.');
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

module.exports = { getNotifications, markRead, deleteNotification };