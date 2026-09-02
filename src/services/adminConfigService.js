// src/services/adminConfigService.js
// SERVICE METIER - Configuration globale, mode maintenance et versions
// STANDARD: Industriel / Bank Grade (Modularise < 325 lignes, Sans Emojis)

const mongoose = require('mongoose');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Settings = require('../models/Settings');
const AuditLog = require('../models/AuditLog');
const notificationService = require('./notificationService');
const logger = require('../config/logger');
const AppError = require('../utils/AppError');

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
      { $match: { status: 'COMPLETED' } },
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
    { $match: { status: { $in: ['COMPLETED', 'APPROVED'] } } },
    { $group: { _id: '$planId', totalAmount: { $sum: '$amount' }, count: { $sum: 1 } } }
  ];
  return await Transaction.aggregate(pipeline);
};

const toggleMaintenanceMode = async (isMaintenanceMode, maintenanceMessage, requesterId, requesterEmail, io) => {
  let settings = await Settings.findOne();
  if (!settings) settings = new Settings();

  if (isMaintenanceMode !== undefined) {
    settings.isMaintenanceMode = Boolean(isMaintenanceMode);
  }
  if (maintenanceMessage) {
    settings.maintenanceMessage = maintenanceMessage.trim();
  }
  settings.updatedBy = requesterId;
  await settings.save();

  if (io) {
    io.emit('SYSTEM_MAINTENANCE_TOGGLED', {
      isMaintenanceMode: settings.isMaintenanceMode,
      maintenanceMessage: settings.maintenanceMessage
    });
  }

  logger.warn(`[MAINTENANCE] Mode maintenance mis a jour (${settings.isMaintenanceMode}) par ${requesterEmail}`);
  await logSystemAction(requesterId, 'TOGGLE_MAINTENANCE', settings._id, `Maintenance set to ${settings.isMaintenanceMode}`);

  return {
    isMaintenanceMode: settings.isMaintenanceMode,
    maintenanceMessage: settings.maintenanceMessage
  };
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
  if (!settings) settings = new Settings();

  const wasActive = settings.isGlobalFreeAccess;

  if (isGlobalFreeAccess !== undefined) {
    settings.isGlobalFreeAccess = isGlobalFreeAccess;
  }
  if (promoMessage) {
    settings.promoMessage = promoMessage;
  }

  if (settings.isGlobalFreeAccess && !wasActive) {
    settings.promoStartedAt = new Date();
    logger.info(`[VIP MODE] Activation du mode VIP.`);
  } else if (!settings.isGlobalFreeAccess && wasActive) {
    if (settings.promoStartedAt) {
      const durationMs = Date.now() - settings.promoStartedAt.getTime();
      if (durationMs > 0) {
        await User.updateMany(
          { 'subscription.isActive': true, 'subscription.expiresAt': { $gt: new Date() } },
          [{ $set: { 'subscription.expiresAt': { $add: ['$subscription.expiresAt', durationMs] } } }]
        );
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

  await logSystemAction(requesterId, 'TOGGLE_FREE_ACCESS', settings._id, `VIP Mode set to ${settings.isGlobalFreeAccess}`);
  return { isGlobalFreeAccess: settings.isGlobalFreeAccess, promoMessage: settings.promoMessage };
};

const updateAppVersion = async (versionData, requesterId, requesterEmail, io) => {
  const { latestVersion, latestVersionCode, minVersionCode, mandatoryUpdate, updateUrl, isOta } = versionData;
  
  let settings = await Settings.findOne();
  if (!settings) settings = new Settings();
  
  if (latestVersion) settings.latestVersion = latestVersion;
  if (latestVersionCode !== undefined) settings.latestVersionCode = Number(latestVersionCode);
  if (minVersionCode !== undefined) settings.minVersionCode = Number(minVersionCode);
  if (mandatoryUpdate !== undefined) settings.mandatoryUpdate = Boolean(mandatoryUpdate);
  if (updateUrl) settings.updateUrl = updateUrl;
  if (isOta !== undefined) settings.isOta = Boolean(isOta);
  settings.updatedBy = requesterId;
  
  await settings.save();

  if (io) {
    io.emit('APP_VERSION_UPDATED', { 
      latestVersion: settings.latestVersion,
      latestVersionCode: settings.latestVersionCode,
      minVersionCode: settings.minVersionCode,
      mandatoryUpdate: settings.mandatoryUpdate, 
      updateUrl: settings.updateUrl,
      isOta: settings.isOta 
    });
  }

  await logSystemAction(requesterId, 'UPDATE_APP_VERSION', settings._id, `App Version set to ${settings.latestVersion}`);
  return settings;
};

module.exports = {
  getDashboardStats,
  getFinanceData,
  toggleMaintenanceMode,
  togglePromo,
  updateWaveLinks,
  getSystemConfig,
  toggleLoadReduce,
  toggleGlobalFreeAccess,
  updateAppVersion
};
