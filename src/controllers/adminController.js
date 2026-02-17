// src/controllers/adminController.js
// CONTRÔLEUR ADMIN - Purge Totale de la Logique d'Infrastructure
// CSCSM Level: Bank Grade

const mongoose = require('mongoose');
const adminService = require('../services/adminService');
const subscriptionService = require('../services/subscriptionService'); // ✅ IMPORT DU NOUVEAU SERVICE
const { successResponse, errorResponse } = require('../utils/responseHandler');
const logger = require('../config/logger');

/**
 * @desc Promouvoir/Rétrograder (SuperAdmin)
 */
const updateAdminStatus = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const { userId, action } = req.body;
    
    const result = await session.withTransaction(async () => {
      return await adminService.updateUserRole(userId, action, req.user._id, session);
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
    const user = await adminService.toggleUserBan(userId, reason, req.user._id);
    
    logger.warn(`[AUDIT BAN] ${req.user.email} toggled ban on ${user.email}.`);
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

    // ✅ DÉLÉGATION AU SERVICE : Plus d'appel direct à Cloudinary !
    if (result.proofPublicId) {
      await subscriptionService.deleteProof(result.proofPublicId);
    }

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

    // ✅ DÉLÉGATION AU SERVICE
    if (result.proofPublicId) {
      await subscriptionService.deleteProof(result.proofPublicId);
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
 * @desc Get Validation Queue
 */
const getValidationQueue = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    
    // ✅ DÉLÉGATION AU SERVICE : Plus aucune requête Mongoose dans le contrôleur !
    const data = await subscriptionService.getPendingTransactions(req.user.role, page);

    return successResponse(res, data, "File d'attente récupérée.");
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @desc Dashboard Stats
 */
const getDashboardStats = async (req, res) => {
  try {
    const stats = await adminService.getDashboardStats();
    return successResponse(res, stats, "Statistiques récupérées.");
  } catch (error) {
    logger.error(`[ADMIN STATS] Erreur: ${error.message}`);
    return errorResponse(res, "Impossible de récupérer les statistiques.", 500);
  }
};

/**
 * @desc Get All Users
 */
const getAllUsers = async (req, res) => {
  try {
    const result = await adminService.getAllUsers(req.query, req.user.role);
    return successResponse(res, { users: result.users, pagination: result.pagination }, "Utilisateurs récupérés.");
  } catch (error) {
    logger.error(`[ADMIN USERS] Erreur: ${error.message}`);
    return errorResponse(res, "Impossible de récupérer les utilisateurs.", 500);
  }
};

module.exports = {
  updateAdminStatus,
  toggleUserBan,
  updateMapSettings,
  approveTransaction,
  rejectTransaction,
  getValidationQueue,
  getDashboardStats,
  getAllUsers
};