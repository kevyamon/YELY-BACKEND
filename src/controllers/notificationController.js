// src/controllers/notificationController.js
const notificationService = require('../services/notificationService');
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

module.exports = { getNotifications, markRead };