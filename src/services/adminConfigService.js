// src/services/adminConfigService.js
// SERVICE METIER - Gestion de la configuration globale du systeme, promotions et versions
// STANDARD: Industriel / Bank Grade

const mongoose = require('mongoose');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Settings = require('../models/Settings');
const AuditLog = require('../models/AuditLog');
const notificationService = require('./notificationService');
const logger = require('../config/logger');
const AppError = require('../utils/AppError');

// Audit log helper local
const logSystemAction = async (actorId, action, targetId, details) => {
  try {
    await AuditLog.create({
      actor: actorId,
      action,
      target: targetId,
      details
    });
  } catch (error) {
    logger.error(`[AUDIT ERROR] Echec d'ecriture du log (${action}): ${error.message}`);
  }
};

const getDashboardStats = async () => {
  const [totalRiders, totalDrivers, activeDrivers, pendingValidations, pendingDriverValidations, revenueData, settings] = await Promise.all([
    User.countDocuments({ role: 'rider' }),
    User.countDocuments({ role: 'driver' }),
    User.countDocuments({ role: 'driver', isAvailable: true }),
    Transaction.countDocuments({ status: 'PENDING' }),
    User.countDocuments({ role: 'driver', verificationStatus: 'pending' }),
    Transaction.aggregate([
      { $match: { status: 'APPROVED' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]),
    Settings.findOne().lean()
  ]);

  return {
    totalUsers: totalRiders + totalDrivers,
    totalRiders,
    totalDrivers,
    activeDrivers,
    pendingValidations,
    pendingDriverValidations,
    totalRevenue: revenueData.length > 0 ? revenueData[0].total : 0,
    settings 
  };
};

const getFinanceData = async (period) => {
  const pipeline = [
    { $match: { status: 'APPROVED' } },
    { $group: { _id: '$planId', totalAmount: { $sum: '$amount' }, count: { $sum: 1 } } }
  ];
  return await Transaction.aggregate(pipeline);
};

const togglePromo = async (isActive, requesterId) => {
  let settings = await Settings.findOne();
  if (!settings) settings = new Settings();
  
  settings.isPromoActive = isActive;
  settings.updatedBy = requesterId;
  await settings.save();
  
  await logSystemAction(requesterId, 'TOGGLE_PROMO', settings._id, `Statut promo: ${isActive}`);
  return { isPromoActive: settings.isPromoActive };
};

const updateWaveLinks = async (weeklyLink, monthlyLink, requesterId) => {
  let settings = await Settings.findOne();
  if (!settings) settings = new Settings();
  
  if (weeklyLink) settings.waveLinkWeekly = weeklyLink;
  if (monthlyLink) settings.waveLinkMonthly = monthlyLink;
  settings.updatedBy = requesterId;
  
  await settings.save();
  await logSystemAction(requesterId, 'UPDATE_WAVE_LINKS', settings._id, 'Mise a jour liens Wave');
  return { waveLinkWeekly: settings.waveLinkWeekly, waveLinkMonthly: settings.waveLinkMonthly };
};

const getSystemConfig = async () => {
  let settings = await Settings.findOne();
  if (!settings) {
    settings = await Settings.create({});
  }
  return settings;
};

const toggleLoadReduce = async (requesterId, requesterEmail, io) => {
  let settings = await Settings.findOne();
  if (!settings) settings = await Settings.create({});

  settings.isLoadReduced = !settings.isLoadReduced;
  settings.weeklyCounter = 0;
  settings.monthlyCounter = 0;
  
  await settings.save();

  if (io) {
    io.to(requesterId.toString()).emit('load_reduce_updated', { isLoadReduced: settings.isLoadReduced });
  }

  await logSystemAction(requesterId, 'TOGGLE_LOAD_REDUCE', settings._id, `Load Reduction set to ${settings.isLoadReduced}`);
  return { isLoadReduced: settings.isLoadReduced };
};

const toggleGlobalFreeAccess = async (isGlobalFreeAccess, promoMessage, requesterId, requesterEmail, io) => {
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
        await User.updateMany(
          { 'subscription.isActive': true, 'subscription.expiresAt': { $gt: new Date() } },
          [{ $set: { 'subscription.expiresAt': { $add: ['$subscription.expiresAt', durationMs] } } }]
        );
        logger.info(`[VIP MODE] Fin du VIP. Compensation de ${durationMs}ms ajoutee aux abonnements actifs.`);
      }
    }
    settings.promoStartedAt = null;
  }
  
  settings.updatedBy = requesterId;
  await settings.save();

  if (io) {
    io.emit('PROMO_MODE_CHANGED', {
      isGlobalFreeAccess: settings.isGlobalFreeAccess,
      promoMessage: settings.promoMessage
    });
  }

  const pushTitle = settings.isGlobalFreeAccess ? "Mode VIP Activé !" : "Fin de la période VIP";
  const pushBody = settings.isGlobalFreeAccess 
    ? "L'accès à Yely est désormais gratuit ! Votre abonnement payant est mis en pause." 
    : "Le mode gratuit est terminé. Votre abonnement a été prolongé pour compenser cette période.";

  try {
    const drivers = await User.find({ role: { $in: ['driver', 'seller'] }, fcmToken: { $ne: null } }).select('_id fcmToken');
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

  await logSystemAction(requesterId, 'TOGGLE_FREE_ACCESS', settings._id, `VIP Mode set to ${settings.isGlobalFreeAccess}`);
  return { isGlobalFreeAccess: settings.isGlobalFreeAccess, promoMessage: settings.promoMessage };
};

const updateAppVersion = async (versionData, requesterId, requesterEmail, io) => {
  const { latestVersion, mandatoryUpdate, updateUrl, isOta } = versionData;
  
  let settings = await Settings.findOne();
  if (!settings) {
    settings = new Settings();
  }
  
  settings.latestVersion = latestVersion;
  settings.mandatoryUpdate = mandatoryUpdate;
  settings.updateUrl = updateUrl;
  settings.isOta = isOta;
  settings.updatedBy = requesterId;
  
  await settings.save();

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

  await logSystemAction(requesterId, 'UPDATE_APP_VERSION', settings._id, `App Version set to ${latestVersion}`);
  return settings;
};

module.exports = {
  getDashboardStats,
  getFinanceData,
  togglePromo,
  updateWaveLinks,
  getSystemConfig,
  toggleLoadReduce,
  toggleGlobalFreeAccess,
  updateAppVersion
};
