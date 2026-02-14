// src/controllers/adminController.js
// CONTRÔLEUR ADMIN - "Skinny Controller" (Délègue au Service)
// CSCSM Level: Bank Grade

const mongoose = require('mongoose');
const adminService = require('../services/adminService');
const cloudinary = require('../config/cloudinary');
const { successResponse, errorResponse } = require('../utils/responseHandler');
const logger = require('../config/logger');
const User = require('../models/User'); // Pour le listage simple
const Transaction = require('../models/Transaction'); // Pour la queue simple

/**
 * @desc Promouvoir/Rétrograder (SuperAdmin)
 */
const updateAdminStatus = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const { userId, action } = req.body;
    
    const result = await session.withTransaction(async () => {
      const res = await adminService.updateUserRole(userId, action, req.user._id, session);
      // Audit dans la transaction ? Non, l'audit est un side-effect
      return res;
    });

    logger.warn(`[AUDIT ROLE] ${req.user.email} changed ${result.user.email} -> ${result.newRole}`);
    return successResponse(res, result, 'Rôle mis à jour.');

  } catch (error) {
    return errorResponse(res, error.message, error.statusCode || 500);
  } finally {
    session.endSession();
  }
};

/**
 * @desc Toggle Ban
 */
const toggleUserBan = async (req, res) => {
  try {
    const { userId, reason } = req.body;
    const user = await adminService.toggleUserBan(userId, reason);
    
    logger.warn(`[AUDIT BAN] ${req.user.email} toggled ban on ${user.email}. Status: ${user.isBanned}`);
    return successResponse(res, { isBanned: user.isBanned }, user.isBanned ? 'Utilisateur banni.' : 'Bannissement levé.');

  } catch (error) {
    return errorResponse(res, error.message, error.statusCode || 500);
  }
};

/**
 * @desc Map Settings
 */
const updateMapSettings = async (req, res) => {
  try {
    const settings = await adminService.updateMapSettings(req.body, req.user._id);
    logger.info(`[AUDIT MAP] Settings updated by ${req.user.email}`);
    return successResponse(res, settings, 'Paramètres mis à jour.');
  } catch (error) {
    return errorResponse(res, error.message, error.statusCode || 500);
  }
};

/**
 * @desc Approve Transaction
 */
const approveTransaction = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const result = await session.withTransaction(async () => {
      return await adminService.approveTransaction(req.params.id, req.user._id, session);
    });

    // Nettoyage Cloudinary Async
    if (result.proofPublicId) {
      cloudinary.uploader.destroy(result.proofPublicId).catch(err => 
        logger.warn(`[CLOUDINARY] Clean fail: ${err.message}`)
      );
    }

    // Notification Socket
    const io = req.app.get('socketio');
    io.to(result.driver._id.toString()).emit('subscription_validated', {
      hoursAdded: result.hoursToAdd,
      totalHours: result.driver.subscription.hoursRemaining
    });

    logger.info(`[AUDIT FINANCE] Transaction ${result.transaction._id} approved by ${req.user.email}`);
    return successResponse(res, { status: 'APPROVED' }, 'Transaction approuvée.');

  } catch (error) {
    return errorResponse(res, error.message, error.statusCode || 500);
  } finally {
    session.endSession();
  }
};

/**
 * @desc Reject Transaction
 */
const rejectTransaction = async (req, res) => {
  try {
    const { reason } = req.body;
    const result = await adminService.rejectTransaction(req.params.id, reason, req.user._id);

    if (result.proofPublicId) {
      cloudinary.uploader.destroy(result.proofPublicId).catch(err => 
        logger.warn(`[CLOUDINARY] Clean fail: ${err.message}`)
      );
    }

    const io = req.app.get('socketio');
    io.to(result.transaction.driver.toString()).emit('subscription_rejected', { reason });

    logger.info(`[AUDIT FINANCE] Transaction ${result.transaction._id} rejected by ${req.user.email}`);
    return successResponse(res, { status: 'REJECTED' }, 'Transaction rejetée.');

  } catch (error) {
    return errorResponse(res, error.message, error.statusCode || 500);
  }
};

/**
 * @desc Get Validation Queue (Lecture seule, pas besoin de service complexe)
 */
const getValidationQueue = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 20;
    const skip = (page - 1) * limit;

    const query = { status: 'PENDING' };
    if (req.user.role === 'admin') query.assignedTo = 'PARTNER';

    const [transactions, total] = await Promise.all([
      Transaction.find(query).populate('driver', 'name phone vehicle subscription').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Transaction.countDocuments(query)
    ]);

    return successResponse(res, { transactions, pagination: { page, total, pages: Math.ceil(total/limit) } }, "File d'attente récupérée.");
  } catch (error) {
    return errorResponse(res, error.message);
  }
};

// ... (Pour getAllUsers et getDashboardStats, tu peux garder la logique simple actuelle ou la déplacer aussi)

module.exports = {
  updateAdminStatus,
  toggleUserBan,
  updateMapSettings,
  approveTransaction,
  rejectTransaction,
  getValidationQueue,
  // ... exporte aussi les autres méthodes de lecture si tu les gardes ici
  getDashboardStats: require('./adminController_read').getDashboardStats, // Optionnel: séparer lecture/écriture
  getAllUsers: require('./adminController_read').getAllUsers 
};