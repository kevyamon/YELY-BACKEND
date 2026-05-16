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
    const finalReason = reason || "Preuve non conforme ou illisible.";
    const result = await adminService.rejectTransaction(req.params.id, finalReason, req.user._id);

    try {
      const io = req.app.get('socketio');
      if (io) {
        io.to(result.driver._id.toString()).emit('subscription_rejected', { reason: finalReason });
      }
      
      notificationService.sendNotification(
        result.driver._id.toString(),
        "Paiement Rejete",
        `Votre preuve a ete refusee: ${finalReason}. Veuillez soumettre une image valide.`,
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
      const drivers = await User.find({ role: 'driver', fcmToken: { $ne: null } }).select('_id fcmToken');
      const sentTokens = new Set();

      for (const driver of drivers) {
        const skipPush = sentTokens.has(driver.fcmToken);
        if (driver.fcmToken) sentTokens.add(driver.fcmToken);

        notificationService.sendNotification(
          driver._id,
          pushTitle,
          pushBody,
          'PROMO_UPDATE',
          { isGlobalFreeAccess: settings.isGlobalFreeAccess.toString() },
          skipPush
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

    try {
      const users = await User.find({ fcmToken: { $ne: null }, role: { $ne: 'superadmin' } }).select('_id fcmToken');
      const sentTokens = new Set();
      const pushTitle = mandatoryUpdate ? "Mise a jour obligatoire requise" : "Nouvelle mise a jour disponible";
      const pushBody = `La version ${latestVersion} de Yely est disponible. Profitez des dernieres ameliorations !`;
      
      for (const u of users) {
        const skipPush = sentTokens.has(u.fcmToken);
        if (u.fcmToken) sentTokens.add(u.fcmToken);

        notificationService.sendNotification(
          u._id,
          pushTitle,
          pushBody,
          'SYSTEM_UPDATE',
          { latestVersion, mandatoryUpdate: String(mandatoryUpdate), updateUrl, isOta: String(isOta) },
          skipPush
        ).catch(() => {});
      }
    } catch (pushErr) {
      logger.warn(`[Admin] Echec non-bloquant du Push Update: ${pushErr.message}`);
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

const getAllRides = async (req, res) => {
  try {
    const result = await adminService.getAllRidesHistory(req.query);
    return successResponse(res, result, "Historique des courses recupere avec succes.");
  } catch (error) {
    logger.error(`[ADMIN RIDES ERROR] Erreur: ${error.message}`);
    return errorResponse(res, "Impossible de recuperer l'historique des courses.", 500);
  }
};

const toggleRideArchive = async (req, res) => {
  try {
    const ride = await adminService.toggleRideArchive(req.params.id, req.user._id);
    return successResponse(res, { isArchived: ride.isArchivedByAdmin }, 
      ride.isArchivedByAdmin ? "Course archivee." : "Course desarchivee."
    );
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

const getMarketplaceStats = async (req, res) => {
  try {
    const Order = require('../models/Order');
    const Ledger = require('../models/Ledger');

    const [salesResult, pendingOrdersCount, activeDeliveriesCount, ledgerResult] = await Promise.all([
      Order.aggregate([
        { $match: { status: { $nin: ['cancelled', 'cancelled_no_driver', 'rejected'] } } },
        { $group: { _id: null, total: { $sum: '$itemsPrice' } } }
      ]),
      Order.countDocuments({ status: 'pending' }),
      Order.countDocuments({ status: { $in: ['searching', 'picked_up', 'searching_delivery_retry'] } }),
      Ledger.aggregate([
        { $match: { status: 'pending' } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ])
    ]);

    const stats = {
      totalSales: salesResult.length > 0 ? salesResult[0].total : 0,
      pendingOrdersCount,
      activeDeliveriesCount,
      totalLedgerDebt: ledgerResult.length > 0 ? ledgerResult[0].total : 0
    };

    return successResponse(res, stats, "Statistiques Marketplace récupérées.");
  } catch (error) {
    logger.error(`[ADMIN MARKET STATS ERROR] : ${error.message}`);
    return errorResponse(res, "Erreur statistiques marketplace.", 500);
  }
};

const getMarketplaceOrders = async (req, res) => {
  try {
    const Order = require('../models/Order');
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;

    const filter = {};
    if (req.query.status) {
      filter.status = req.query.status;
    }

    if (req.query.search) {
      const safeSearch = req.query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const searchRegex = new RegExp(safeSearch, 'i');
      
      if (mongoose.Types.ObjectId.isValid(req.query.search)) {
        filter._id = req.query.search;
      } else {
        const matchingUsers = await User.find({
          $or: [
            { name: searchRegex },
            { phone: searchRegex },
            { email: searchRegex }
          ]
        }).select('_id');
        const userIds = matchingUsers.map(u => u._id);
        
        filter.$or = [
          { customer: { $in: userIds } },
          { seller: { $in: userIds } },
          { driver: { $in: userIds } }
        ];
      }
    }

    const [orders, total] = await Promise.all([
      Order.find(filter)
        .populate('customer', 'name phone email')
        .populate('seller', 'name phone email')
        .populate('driver', 'name phone email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Order.countDocuments(filter)
    ]);

    return successResponse(res, {
      orders,
      pagination: { page, total, pages: Math.ceil(total / limit) }
    }, "Commandes récupérées.");
  } catch (error) {
    logger.error(`[ADMIN MARKET ORDERS ERROR] : ${error.message}`);
    return errorResponse(res, "Erreur récupération commandes.", 500);
  }
};

const overrideMarketplaceOrder = async (req, res) => {
  try {
    const Order = require('../models/Order');
    const rideLifecycleService = require('../services/ride/rideLifecycleService');
    const { id } = req.params;
    const { status, driverId, cancelRide, reason } = req.body;

    const order = await Order.findById(id).populate('customer seller driver');
    if (!order) {
      return errorResponse(res, "Commande introuvable.", 404);
    }

    const oldStatus = order.status;
    const oldDriverName = order.driver?.name || 'aucun';

    if (cancelRide && order.deliveryRideId) {
      try {
        await rideLifecycleService.cancelRideAction(
          order.deliveryRideId,
          req.user,
          'admin',
          reason || 'Annulation administrative forcée'
        );
        order.deliveryRideId = undefined;
      } catch (rideErr) {
        logger.error(`[ADMIN OVERRIDE RIDE CANCEL] Non bloquant : ${rideErr.message}`);
      }
    }

    if (driverId !== undefined) {
      if (driverId === null || driverId === '') {
        order.driver = undefined;
      } else {
        const targetDriver = await User.findById(driverId);
        if (!targetDriver || targetDriver.role !== 'driver') {
          return errorResponse(res, "Le livreur spécifié est invalide.", 400);
        }
        order.driver = targetDriver._id;
      }
    }

    if (status) {
      order.status = status;
      if (status === 'delivered') {
        order.deliveredAt = Date.now();
      } else if (status === 'picked_up') {
        order.pickedUpAt = Date.now();
      } else if (status === 'cancelled') {
        order.cancelledAt = Date.now();
      }
      order.history.push({
        status,
        comment: reason || `Statut forcé administrativement par ${req.user.name || 'Admin'}`,
        timestamp: Date.now()
      });
    }

    await order.save();

    const io = req.app.get('socketio');
    const updatedOrder = await Order.findById(id).populate('customer seller driver');
    if (io && updatedOrder) {
      io.to(updatedOrder.customer._id.toString()).emit('order_updated', updatedOrder);
      io.to(updatedOrder.seller._id.toString()).emit('order_updated', updatedOrder);
    }

    await AuditLog.create({
      actor: req.user._id,
      action: 'OVERRIDE_MARKETPLACE_ORDER',
      target: order._id,
      details: `Override commande #${order._id.toString().slice(-6)}: Statut ${oldStatus} -> ${status || oldStatus}, Livreur ${oldDriverName} -> ${updatedOrder.driver?.name || 'aucun'}. Motif: ${reason || 'aucun'}`
    });

    return successResponse(res, updatedOrder, "Commande écrasée et mise à jour avec succès.");
  } catch (error) {
    logger.error(`[ADMIN ORDER OVERRIDE ERROR] : ${error.message}`);
    return errorResponse(res, "Erreur override commande.", 500);
  }
};

const getMarketplaceLedgers = async (req, res) => {
  try {
    const Ledger = require('../models/Ledger');
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;

    const filter = {};
    if (req.query.status) {
      filter.status = req.query.status;
    }

    if (req.query.search) {
      const safeSearch = req.query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const searchRegex = new RegExp(safeSearch, 'i');
      
      const matchingUsers = await User.find({
        $or: [
          { name: searchRegex },
          { phone: searchRegex }
        ]
      }).select('_id');
      const userIds = matchingUsers.map(u => u._id);

      filter.$or = [
        { driver: { $in: userIds } },
        { seller: { $in: userIds } }
      ];
    }

    const [ledgers, total] = await Promise.all([
      Ledger.find(filter)
        .populate('driver', 'name phone email ledger')
        .populate('seller', 'name phone email')
        .populate('order', 'status itemsPrice createdAt')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Ledger.countDocuments(filter)
    ]);

    return successResponse(res, {
      ledgers,
      pagination: { page, total, pages: Math.ceil(total / limit) }
    }, "Ardoises financières récupérées.");
  } catch (error) {
    logger.error(`[ADMIN MARKET LEDGERS ERROR] : ${error.message}`);
    return errorResponse(res, "Erreur récupération ardoises.", 500);
  }
};

const forceClearLedger = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const Ledger = require('../models/Ledger');
    const { id } = req.params;
    const { reason } = req.body;

    let resultLedger;

    await session.withTransaction(async () => {
      const ledger = await Ledger.findById(id).session(session);
      if (!ledger) {
        throw new Error("Ardoise introuvable.");
      }

      if (ledger.status === 'cleared') {
        throw new Error("Cette ardoise est déjà réconciliée.");
      }

      ledger.status = 'cleared';
      ledger.clearedAt = Date.now();
      ledger.note = reason || `Réconciliation forcée par le SuperAdmin ${req.user.name || 'SuperAdmin'}`;
      await ledger.save({ session });

      const driver = await User.findById(ledger.driver).session(session);
      if (driver) {
        driver.ledger = driver.ledger || {};
        driver.ledger.currentCashDebt = Math.max(0, (driver.ledger.currentCashDebt || 0) - ledger.amount);
        
        const maxDebt = driver.ledger.maxCashDebt || 100000;
        if (driver.ledger.currentCashDebt < maxDebt) {
          driver.ledger.isBlocked = false;
        }
        await driver.save({ session });
      }

      resultLedger = ledger;
    });

    await session.endSession();

    const io = req.app.get('socketio');
    if (io && resultLedger) {
      io.to(resultLedger.driver.toString()).emit('ledger_cleared', resultLedger);
      io.to(resultLedger.seller.toString()).emit('ledger_cleared', resultLedger);
    }

    await AuditLog.create({
      actor: req.user._id,
      action: 'FORCE_CLEAR_LEDGER',
      target: resultLedger._id,
      details: `Réconciliation forcée de l'ardoise #${resultLedger._id.toString().slice(-6)} (Montant: ${resultLedger.amount} FCFA) pour le livreur ID: ${resultLedger.driver}. Raison: ${reason || 'non spécifiée'}`
    });

    return successResponse(res, resultLedger, "L'ardoise a été réconciliée de force avec succès.");
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    await session.endSession();
    logger.error(`[ADMIN LEDGER FORCE CLEAR ERROR] : ${error.message}`);
    return errorResponse(res, error.message || "Erreur réconciliation ardoise.", 500);
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
  getSystemConfig,
  getAllRides,
  toggleRideArchive,
  getMarketplaceStats,
  getMarketplaceOrders,
  overrideMarketplaceOrder,
  getMarketplaceLedgers,
  forceClearLedger
};