// src/controllers/adminController.js
// CONTROLEUR ADMIN - Exposition des Endpoints HTTP d'Administration
// STANDARD: Industriel / Bank Grade (Delegation active, < 325 lignes, Sans Emojis)

const adminService = require('../services/adminService');
const Transaction = require('../models/Transaction');
const AuditLog = require('../models/AuditLog'); 
const AppError = require('../utils/AppError');
const { successResponse, errorResponse } = require('../utils/responseHandler');
const logger = require('../config/logger');
const notificationService = require('../services/notificationService');
const User = require('../models/User');

const adminConfigController = require('./adminConfigController');
const adminMarketplaceController = require('./adminMarketplaceController');

exports.updateAdminStatus = async (req, res) => {
  try {
    const { userId, action } = req.body;
    const result = await adminService.updateUserRole(userId, action, req.user._id);

    try {
      const io = req.app.get('socketio');
      if (io) {
        io.to(userId.toString()).emit('user_role_updated', { newRole: result.newRole });
        if (result.action === 'REVOKE') {
          io.to(userId.toString()).emit('force_logout', { reason: 'Vos droits administrateur ont ete revoques.' });
        }
      }
    } catch (e) { logger.warn(`[SOCKET] Echec: ${e.message}`); }

    logger.warn(`[AUDIT ROLE] ${req.user.email} changed ${result.email} -> ${result.newRole}`);
    return successResponse(res, result, 'Role mis a jour.');
  } catch (error) {
    return errorResponse(res, error.message, error.statusCode || 500);
  }
};

exports.toggleUserBan = async (req, res) => {
  try {
    const { userId, reason } = req.body;
    const user = await adminService.toggleUserBan(userId, reason, req.user._id);
    
    try {
      const io = req.app.get('socketio');
      if (io) io.to(userId.toString()).emit(user.isBanned ? 'user_banned' : 'user_unbanned', { reason });
    } catch (e) { logger.warn(`[SOCKET] Echec: ${e.message}`); }

    logger.warn(`[AUDIT BAN] ${req.user.email} toggled ban on ${user.email}.`);
    return successResponse(res, { isBanned: user.isBanned }, user.isBanned ? 'Utilisateur banni.' : 'Bannissement leve.');
  } catch (error) {
    return errorResponse(res, error.message, error.statusCode || 500);
  }
};

exports.updateMapSettings = async (req, res) => {
  try {
    const settings = await adminService.updateMapSettings(req.body, req.user._id);
    logger.info(`[AUDIT MAP] Settings updated by ${req.user.email}`);
    return successResponse(res, settings, 'Parametres mis a jour.');
  } catch (error) {
    return errorResponse(res, error.message, error.statusCode || 500);
  }
};

exports.getAllUsers = async (req, res) => {
  try {
    const result = await adminService.getAllUsers(req.query, req.user.role, req.user._id);
    return successResponse(res, { users: result.users, pagination: result.pagination }, "Utilisateurs recuperes.");
  } catch (error) {
    logger.error(`[ADMIN USERS] Erreur: ${error.message}`);
    return errorResponse(res, "Impossible de recuperer les utilisateurs.", 500);
  }
};

exports.getAuditLogs = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 50); 
    const skip = (page - 1) * limit;

    const [logs, total] = await Promise.all([
      AuditLog.find()
        .populate('actor', 'name email role')
        .sort({ createdAt: -1 }) 
        .skip(skip)
        .limit(limit)
        .lean(),
      AuditLog.countDocuments()
    ]);

    return successResponse(res, {
      logs,
      pagination: { page, total, pages: Math.ceil(total / limit) }
    }, "Journal recupere.");
  } catch (error) {
    logger.error(`[AUDIT LOGS ERROR]: ${error.message}`);
    return errorResponse(res, "Impossible de recuperer le journal.", 500);
  }
};

exports.getPendingDrivers = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 10;
    const skip = (page - 1) * limit;
    const query = { role: 'driver', verificationStatus: 'pending' };

    const [drivers, total] = await Promise.all([
      User.find(query)
        .select('name phone email vehicle documents verificationStatus createdAt')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(query)
    ]);

    return successResponse(res, {
      drivers,
      pagination: { page, total, pages: Math.ceil(total / limit) }
    }, "Chauffeurs en attente recuperes avec succes.");
  } catch (error) {
    logger.error(`[PENDING DRIVERS ERROR] ${error.message}`);
    return next(new AppError("Erreur lors de la recuperation des validations d'identite.", 500));
  }
};

exports.verifyDriver = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { decision, reason } = req.body;

    if (!['approved', 'rejected'].includes(decision)) {
      throw new AppError('Decision invalide. Doit etre approved ou rejected.', 400);
    }

    const driver = await User.findById(id);
    if (!driver || driver.role !== 'driver') {
      throw new AppError('Chauffeur introuvable.', 404);
    }

    driver.verificationStatus = decision;
    driver.isAvailable = false;
    driver.rejectionReason = decision === 'rejected' ? (reason || "Documents non conformes.") : "";
    await driver.save();

    await AuditLog.create({
      actor: req.user._id,
      action: decision === 'approved' ? 'APPROVE_DRIVER_IDENTITY' : 'REJECT_DRIVER_IDENTITY',
      target: driver._id,
      details: decision === 'approved' ? 'Identite approuvee' : `Rejet: ${reason}`
    }).catch(() => {});

    try {
      const io = req.app.get('socketio');
      if (io) {
        io.to(driver._id.toString()).emit('identity_verification_update', {
          status: decision,
          reason: driver.rejectionReason
        });
        io.to(driver._id.toString()).emit('force_availability_offline');
      }

      const pushTitle = decision === 'approved' ? "Identite Validee" : "Verification Refusee";
      const pushBody = decision === 'approved'
        ? "Votre identite a ete validee par l'administration."
        : `Votre dossier de verification a ete refuse : ${driver.rejectionReason}`;

      notificationService.sendNotification(
        driver._id.toString(),
        pushTitle,
        pushBody,
        decision === 'approved' ? 'IDENTITY_APPROVED' : 'IDENTITY_REJECTED',
        { status: decision }
      ).catch(() => {});
    } catch (e) {
      logger.error(`[NOTIF ERROR] verifyDriver: ${e.message}`);
    }

    return successResponse(res, { verificationStatus: driver.verificationStatus }, `Dossier chauffeur traite avec succes (${decision}).`);
  } catch (error) {
    return next(error);
  }
};

// --- DELEGATION CONFIGURATION ENDPOINTS ---
exports.getDashboardStats = adminConfigController.getDashboardStats;
exports.getFinanceData = adminConfigController.getFinanceData;
exports.toggleMaintenanceMode = adminConfigController.toggleMaintenanceMode;
exports.togglePromo = adminConfigController.togglePromo;
exports.updateWaveLinks = adminConfigController.updateWaveLinks;
exports.toggleLoadReduce = adminConfigController.toggleLoadReduce;
exports.toggleGlobalFreeAccess = adminConfigController.toggleGlobalFreeAccess;
exports.updateAppVersion = adminConfigController.updateAppVersion;
exports.getSystemConfig = adminConfigController.getSystemConfig;

// --- DELEGATION MARKETPLACE ENDPOINTS ---
exports.getMarketplaceStats = adminMarketplaceController.getMarketplaceStats;
exports.getMarketplaceOrders = adminMarketplaceController.getMarketplaceOrders;
exports.overrideMarketplaceOrder = adminMarketplaceController.overrideMarketplaceOrder;
exports.getMarketplaceLedgers = adminMarketplaceController.getMarketplaceLedgers;
exports.forceClearLedger = adminMarketplaceController.forceClearLedger;
exports.getAllRides = adminMarketplaceController.getAllRides;
exports.toggleRideArchive = adminMarketplaceController.toggleRideArchive;