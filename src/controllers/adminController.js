// src/controllers/adminController.js
// CONTROLEUR ADMIN - Degradation Gracieuse & Tolerance aux Pannes (Isolations Push)
// CSCSM Level: Bank Grade

const mongoose = require('mongoose');
const adminService = require('../services/adminService');
const notificationService = require('../services/notificationService');
const Transaction = require('../models/Transaction');
const AuditLog = require('../models/AuditLog'); 
const Settings = require('../models/Settings'); 
const User = require('../models/User'); 
const { successResponse, errorResponse } = require('../utils/responseHandler');
const logger = require('../config/logger');

const updateAdminStatus = async (req, res) => {
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
    } catch (e) { logger.warn(`[SOCKET] Echec non-critique: ${e.message}`); }

    logger.warn(`[AUDIT ROLE] ${req.user.email} changed ${result.email} -> ${result.newRole}`);
    return successResponse(res, result, 'Role mis a jour.');
  } catch (error) {
    return errorResponse(res, error.message, error.statusCode || 500);
  }
};

const toggleUserBan = async (req, res) => {
  try {
    const { userId, reason } = req.body;
    const user = await adminService.toggleUserBan(userId, reason, req.user._id);
    
    try {
      const io = req.app.get('socketio');
      if (io) io.to(userId.toString()).emit(user.isBanned ? 'user_banned' : 'user_unbanned', { reason });
    } catch (e) { logger.warn(`[SOCKET] Echec non-critique: ${e.message}`); }

    logger.warn(`[AUDIT BAN] ${req.user.email} toggled ban on ${user.email}.`);
    return successResponse(res, { isBanned: user.isBanned }, user.isBanned ? 'Utilisateur banni.' : 'Bannissement leve.');
  } catch (error) {
    return errorResponse(res, error.message, error.statusCode || 500);
  }
};

const updateMapSettings = async (req, res) => {
  try {
    const settings = await adminService.updateMapSettings(req.body, req.user._id);
    logger.info(`[AUDIT MAP] Settings updated by ${req.user.email}`);
    return successResponse(res, settings, 'Parametres mis a jour.');
  } catch (error) {
    return errorResponse(res, error.message, error.statusCode || 500);
  }
};

const approveTransaction = async (req, res) => {
  try {
    const result = await adminService.approveTransaction(req.params.id, req.user._id);

    try {
      const io = req.app.get('socketio');
      if (io) {
        io.to(result.driver._id.toString()).emit('subscription_validated', {
          daysAdded: result.daysToAdd,
          expiresAt: result.newExpiryDate
        });
      }
      
      notificationService.sendNotification(
        result.driver._id.toString(),
        "Abonnement Active",
        "Votre preuve de paiement a ete validee. Vous pouvez reprendre les courses.",
        'SUBSCRIPTION_APPROVED',
        { transactionId: result.transaction._id.toString() }
      ).catch(notifError => logger.error(`[NON-CRITIQUE] Echec notification apres approbation: ${notifError.message}`));
      
    } catch (notifError) {
      logger.error(`[NON-CRITIQUE] Echec general notifications apres approbation: ${notifError.message}`);
    }

    logger.info(`[AUDIT FINANCE] Transaction ${result.transaction._id} approved by ${req.user.email}`);
    return successResponse(res, { status: 'APPROVED' }, 'Transaction approuvee avec succes.');

  } catch (error) {
    return errorResponse(res, error.message, error.statusCode || 500);
  }
};

const rejectTransaction = async (req, res) => {
  try {
    const { reason } = req.body;
    const result = await adminService.rejectTransaction(req.params.id, reason, req.user._id);

    try {
      const io = req.app.get('socketio');
      if (io) {
        io.to(result.driver._id.toString()).emit('subscription_rejected', { reason });
      }
      
      notificationService.sendNotification(
        result.driver._id.toString(),
        "Paiement Rejete",
        `Votre preuve a ete refusee: ${reason}. Veuillez soumettre une image valide.`,
        'SUBSCRIPTION_REJECTED',
        { transactionId: result.transaction._id.toString() }
      ).catch(notifError => logger.error(`[NON-CRITIQUE] Echec notification apres rejet: ${notifError.message}`));
      
    } catch (notifError) {
      logger.error(`[NON-CRITIQUE] Echec general notifications apres rejet: ${notifError.message}`);
    }

    logger.info(`[AUDIT FINANCE] Transaction ${result.transaction._id} rejected by ${req.user.email}`);
    return successResponse(res, { status: 'REJECTED' }, 'Transaction rejetee avec succes.');

  } catch (error) {
    return errorResponse(res, error.message, error.statusCode || 500);
  }
};

const getValidationQueue = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 10;
    const skip = (page - 1) * limit;

    const filter = { status: 'PENDING' };

    if (req.user.role !== 'superadmin') {
      filter.assignedTo = req.user._id;
    }

    const [transactions, total] = await Promise.all([
      Transaction.find(filter)
        .populate('user', 'name phone email currentLocation')
        .populate('assignedTo', 'name email')
        .sort({ createdAt: 1 }) 
        .skip(skip)
        .limit(limit)
        .lean(),
      Transaction.countDocuments(filter)
    ]);

    const data = {
      transactions,
      pagination: {
        page,
        total,
        pages: Math.ceil(total / limit)
      }
    };

    return successResponse(res, data, "File d'attente recuperee.");
  } catch (error) {
    logger.error(`[VALIDATION QUEUE ERROR]: ${error.message}`);
    return errorResponse(res, "Erreur lors de la recuperation des dossiers.", 500);
  }
};

const getDashboardStats = async (req, res) => {
  try {
    const stats = await adminService.getDashboardStats();
    return successResponse(res, stats, "Statistiques recuperees.");
  } catch (error) {
    logger.error(`[ADMIN STATS] Erreur: ${error.message}`);
    return errorResponse(res, "Impossible de recuperer les statistiques.", 500);
  }
};

const getAllUsers = async (req, res) => {
  try {
    const result = await adminService.getAllUsers(req.query, req.user.role, req.user._id);
    return successResponse(res, { users: result.users, pagination: result.pagination }, "Utilisateurs recuperes.");
  } catch (error) {
    logger.error(`[ADMIN USERS] Erreur: ${error.message}`);
    return errorResponse(res, "Impossible de recuperer les utilisateurs.", 500);
  }
};

const getFinanceData = async (req, res) => {
  try {
    const data = await adminService.getFinanceData(req.query.period);
    return successResponse(res, data, "Donnees financieres recuperees.");
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

const togglePromo = async (req, res) => {
  try {
    const result = await adminService.togglePromo(req.body.isActive, req.user._id);

    try {
      const io = req.app.get('socketio');
      if (io) {
        io.emit('promo_updated', { isPromoActive: result.isPromoActive });
      }
    } catch (socketError) {
      logger.error(`[SOCKET PROMO] Echec: ${socketError.message}`);
    }

    return successResponse(res, result, "Statut promo mis a jour.");
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

const updateWaveLinks = async (req, res) => {
  try {
    const { weeklyLink, monthlyLink } = req.body;
    const result = await adminService.updateWaveLinks(weeklyLink, monthlyLink, req.user._id);
    return successResponse(res, result, "Liens Wave mis a jour.");
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

const getAuditLogs = async (req, res) => {
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

const toggleLoadReduce = async (req, res) => {
  try {
    let settings = await Settings.findOne();
    if (!settings) settings = await Settings.create({});

    settings.isLoadReduced = !settings.isLoadReduced;
    settings.weeklyCounter = 0;
    settings.monthlyCounter = 0;
    
    await settings.save();

    try {
      const io = req.app.get('socketio');
      if (io) {
        io.to(req.user._id.toString()).emit('load_reduce_updated', { isLoadReduced: settings.isLoadReduced });
      }
    } catch (e) {
      logger.warn(`[SOCKET PROMO] Echec: ${e.message}`);
    }

    logger.info(`[AUDIT CONFIG] Load Reduction set to ${settings.isLoadReduced} by ${req.user.email}`);
    return successResponse(res, { isLoadReduced: settings.isLoadReduced }, 
      settings.isLoadReduced ? "Mode Reduction de charge active." : "Mode Reduction de charge desactive."
    );
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

const toggleGlobalFreeAccess = async (req, res) => {
  try {
    const { isGlobalFreeAccess, promoMessage } = req.body;

    let settings = await Settings.findOne();
    if (!settings) {
      settings = new Settings();
    }

    const wasActive = settings.isGlobalFreeAccess;

    if (isGlobalFreeAccess !== undefined) {
      settings.isGlobalFreeAccess = isGlobalFreeAccess;
    }
    if (promoMessage) {
      settings.promoMessage = promoMessage;
    }

    if (settings.isGlobalFreeAccess && !wasActive) {
      settings.promoStartedAt = new Date();
      logger.info(`[VIP MODE] Activation. Gel des abonnements declenche.`);
    } 
    else if (!settings.isGlobalFreeAccess && wasActive) {
      if (settings.promoStartedAt) {
        const durationMs = Date.now() - settings.promoStartedAt.getTime();
        
        if (durationMs > 0) {
          await mongoose.model('User').updateMany(
            { 'subscription.isActive': true, 'subscription.expiresAt': { $gt: new Date() } },
            [{ $set: { 'subscription.expiresAt': { $add: ['$subscription.expiresAt', durationMs] } } }]
          );
          logger.info(`[VIP MODE] Fin du VIP. Compensation de ${durationMs}ms ajoutee aux abonnements actifs.`);
        }
      }
      settings.promoStartedAt = null;
    }
    
    settings.updatedBy = req.user._id;
    await settings.save();

    const io = req.app.get('socketio');
    if (io) {
      io.emit('PROMO_MODE_CHANGED', {
        isGlobalFreeAccess: settings.isGlobalFreeAccess,
        promoMessage: settings.promoMessage
      });
    }

    const pushTitle = settings.isGlobalFreeAccess ? "Mode VIP Active !" : "Fin de la periode VIP";
    const pushBody = settings.isGlobalFreeAccess 
      ? "L'acces a Yely est desormais gratuit ! Votre abonnement payant est mis en pause." 
      : "Le mode gratuit est termine. Votre abonnement a ete prolonge pour compenser cette periode.";

    try {
      const drivers = await User.find({ role: 'driver', fcmToken: { $ne: null } });
      for (const driver of drivers) {
        notificationService.sendNotification(
          driver._id,
          pushTitle,
          pushBody,
          'PROMO_UPDATE',
          { isGlobalFreeAccess: settings.isGlobalFreeAccess.toString() }
        ).catch(() => {});
      }
    } catch (pushErr) {
      logger.warn(`[Admin] Echec non-bloquant du Push Promo: ${pushErr.message}`);
    }

    logger.info(`[AUDIT CONFIG] Mode VIP set to ${settings.isGlobalFreeAccess} by ${req.user.email}`);

    return successResponse(res, {
      isGlobalFreeAccess: settings.isGlobalFreeAccess,
      promoMessage: settings.promoMessage
    }, `Mode VIP ${settings.isGlobalFreeAccess ? 'active' : 'desactive'} avec succes.`);

  } catch (error) {
    logger.error(`[FREE ACCESS ERROR]: ${error.message}`);
    return errorResponse(res, error.message, 500);
  }
};

const updateAppVersion = async (req, res) => {
  try {
    const { latestVersion, mandatoryUpdate, updateUrl, isOta } = req.body;
    
    let settings = await Settings.findOne();
    if (!settings) {
      settings = new Settings();
    }
    
    settings.latestVersion = latestVersion;
    settings.mandatoryUpdate = mandatoryUpdate;
    settings.updateUrl = updateUrl;
    settings.isOta = isOta;
    settings.updatedBy = req.user._id;
    
    await settings.save();

    const io = req.app.get('socketio');
    if (io) {
      io.emit('APP_VERSION_UPDATED', { 
        latestVersion, 
        mandatoryUpdate, 
        updateUrl,
        isOta 
      });
    }

    logger.info(`[AUDIT CONFIG] App Version set to ${latestVersion} by ${req.user.email}`);
    
    return successResponse(res, {
      latestVersion: settings.latestVersion,
      mandatoryUpdate: settings.mandatoryUpdate,
      updateUrl: settings.updateUrl,
      isOta: settings.isOta 
    }, "Parametres de version mis a jour et diffuses avec succes.");

  } catch (error) {
    logger.error(`[VERSION UPDATE ERROR]: ${error.message}`);
    return errorResponse(res, error.message, 500);
  }
};

const getSystemConfig = async (req, res) => {
  try {
    let settings = await Settings.findOne();
    if (!settings) {
      settings = await Settings.create({});
    }
    return successResponse(res, settings, "Configuration systeme recuperee.");
  } catch (error) {
    logger.error(`[ADMIN CONFIG ERROR]: ${error.message}`);
    return errorResponse(res, "Impossible de recuperer la configuration systeme.", 500);
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
  updateWaveLinks,
  getAuditLogs,
  toggleLoadReduce,
  toggleGlobalFreeAccess,
  updateAppVersion,
  getSystemConfig
};