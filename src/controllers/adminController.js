// src/controllers/adminController.js
// CONTRÔLEUR ADMIN - Intégration Temps Réel & Restauration Complète
// CSCSM Level: Bank Grade

const mongoose = require('mongoose');
const adminService = require('../services/adminService');
const subscriptionService = require('../services/subscriptionService');
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

    // NOTIFICATION TEMPS RÉEL (DÉCONNEXION/MISE À JOUR FORCÉE)
    const io = req.app.get('socketio');
    if (io) {
      io.to(userId.toString()).emit('user_role_updated', { newRole: result.newRole });
    }

    logger.warn(`[AUDIT ROLE] ${req.user.email} changed ${result.email} -> ${result.newRole}`);
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
    
    // NOTIFICATION TEMPS RÉEL (KICK UTILISATEUR)
    const io = req.app.get('socketio');
    if (io) {
      io.to(userId.toString()).emit(user.isBanned ? 'user_banned' : 'user_unbanned', { reason });
    }

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

    if (result.transaction.proofPublicId) {
      await subscriptionService.deleteProof(result.transaction.proofPublicId);
    }

    const io = req.app.get('socketio');
    if (io) {
      io.to(result.driver._id.toString()).emit('subscription_validated', {
        hoursAdded: result.hoursToAdd,
        totalHours: result.driver.subscription.hoursRemaining
      });
    }

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

    if (result.transaction && result.transaction.proofPublicId) {
      await subscriptionService.deleteProof(result.transaction.proofPublicId);
    }

    const io = req.app.get('socketio');
    if (io) {
      io.to(result.transaction.driver.toString()).emit('subscription_rejected', { reason });
    }

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

/**
 * @desc Finance Data
 */
const getFinanceData = async (req, res) => {
  try {
    const data = await adminService.getFinanceData(req.query.period);
    return successResponse(res, data, "Données financières récupérées.");
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @desc Toggle Promo
 */
const togglePromo = async (req, res) => {
  try {
    const result = await adminService.togglePromo(req.body.isActive, req.user._id);
    return successResponse(res, result, "Statut promo mis à jour.");
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @desc Update Wave Links
 */
const updateWaveLinks = async (req, res) => {
  try {
    const { weeklyLink, monthlyLink } = req.body;
    const result = await adminService.updateWaveLinks(weeklyLink, monthlyLink, req.user._id);
    return successResponse(res, result, "Liens Wave mis à jour.");
  } catch (error) {
    return errorResponse(res, error.message, 500);
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
  getAllUsers,
  getFinanceData,
  togglePromo,
  updateWaveLinks
};