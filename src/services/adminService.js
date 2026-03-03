// src/services/adminService.js
// LOGIQUE DE GOUVERNANCE - Diagnostics d'erreurs stricts et precis
// CSCSM Level: Bank Grade

const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Settings = require('../models/Settings');
const AuditLog = require('../models/AuditLog');
const AppError = require('../utils/AppError');
const mongoose = require('mongoose');
const redisClient = require('../config/redis');

const logSystemAction = async (actorId, action, targetId, details) => {
  await AuditLog.create({
    actor: actorId,
    action,
    target: targetId,
    details
  });
};

const updateUserRole = async (userId, action, requesterId) => {
  if (userId === requesterId.toString()) throw new AppError('Auto-promotion interdite.', 403);

  const user = await User.findById(userId);
  if (!user) throw new AppError('Utilisateur introuvable.', 404);
  if (user.role === 'superadmin') throw new AppError('Le SuperAdmin est intouchable.', 403);

  const transitions = {
    'PROMOTE': { from: ['rider', 'driver'], to: 'admin' },
    'REVOKE': { from: ['admin'], to: 'rider' }
  };

  if (!transitions[action].from.includes(user.role)) {
    throw new AppError(`Action impossible sur un profil ${user.role}.`, 400);
  }

  const oldRole = user.role;
  user.role = transitions[action].to;
  await user.save();

  await logSystemAction(requesterId, `${action}_USER`, user._id, `De ${oldRole} vers ${user.role}`);
  try { await redisClient.del(`auth:user:${user._id}`); } catch(e) {}
  
  return { email: user.email, newRole: user.role };
};

const toggleUserBan = async (userId, reason, requesterId) => {
  const user = await User.findById(userId);
  if (!user || user.role === 'superadmin') throw new AppError('Action impossible.', 403);

  user.isBanned = !user.isBanned;
  user.banReason = user.isBanned ? reason : '';
  if (user.isBanned) user.isAvailable = false;
  await user.save();

  await logSystemAction(requesterId, user.isBanned ? 'BAN_USER' : 'UNBAN_USER', user._id, reason);
  try { await redisClient.del(`auth:user:${user._id}`); } catch(e) {}
  
  return user;
};

const updateMapSettings = async (data, requesterId) => {
  let settings = await Settings.findOne();
  if (!settings) settings = new Settings();

  settings.isMapLocked = data.isMapLocked;
  settings.serviceCity = data.serviceCity;
  settings.allowedRadiusKm = data.radius;
  settings.allowedCenter = { type: 'Point', coordinates: data.allowedCenter.coordinates };
  settings.updatedBy = requesterId;

  await settings.save();
  await logSystemAction(requesterId, 'UPDATE_MAP_SETTINGS', settings._id, `Ville: ${data.serviceCity}`);
  
  return settings;
};

/**
 * REPARATION SECURITE : Diagnostic des erreurs separe pour le frontend
 */
const approveTransaction = async (transactionId, validatorId) => {
  const cleanId = transactionId.toString().trim();
  const transaction = await Transaction.findById(cleanId);
  
  if (!transaction) {
    throw new AppError('Transaction introuvable dans la base de donnees.', 404);
  }

  if (transaction.status !== 'PENDING') {
    throw new AppError(`Action impossible : Cette transaction est deja ${transaction.status}. Veuillez rafraichir.`, 400);
  }

  const driver = await User.findById(transaction.user);
  if (!driver) throw new AppError('Chauffeur introuvable.', 404);

  const daysToAdd = transaction.planId === 'WEEKLY' ? 7 : 30;
  
  let newExpiryDate = new Date();
  if (driver.subscriptionExpiresAt && driver.subscriptionExpiresAt > new Date()) {
    newExpiryDate = new Date(driver.subscriptionExpiresAt);
  }
  newExpiryDate.setDate(newExpiryDate.getDate() + daysToAdd);

  driver.subscriptionExpiresAt = newExpiryDate;
  driver.subscriptionStatus = 'active'; 
  if (driver.subscription) {
    driver.subscription.status = 'active';
  }
  await driver.save();

  transaction.status = 'APPROVED';
  transaction.validatedBy = validatorId;
  transaction.auditLog.push({
    action: 'APPROVAL',
    note: `Preuve validee par l'admin ${validatorId}. Acces prolonge de ${daysToAdd} jours.`
  });
  await transaction.save();

  const details = `Transaction [${transaction._id}] de ${transaction.amount} FCFA validee. +${daysToAdd} jours ajoutes pour ${driver.email}`;
  await logSystemAction(validatorId, 'APPROVE_SUBSCRIPTION', driver._id, details);
  
  try { await redisClient.del(`auth:user:${driver._id}`); } catch(e) {}

  return { transaction, driver, daysToAdd, newExpiryDate };
};

const rejectTransaction = async (transactionId, reason, validatorId) => {
  const cleanId = transactionId.toString().trim();
  const transaction = await Transaction.findById(cleanId);
  
  if (!transaction) {
    throw new AppError('Transaction introuvable dans la base de donnees.', 404);
  }

  if (transaction.status !== 'PENDING') {
    throw new AppError(`Action impossible : Cette transaction est deja ${transaction.status}. Veuillez rafraichir.`, 400);
  }

  transaction.status = 'REJECTED';
  transaction.validatedBy = validatorId;
  transaction.auditLog.push({
    action: 'REJECTION',
    note: `Preuve rejetee par l'admin ${validatorId}. Motif: ${reason}`
  });
  await transaction.save();

  const driver = await User.findById(transaction.user);
  
  if (driver) {
    driver.subscriptionStatus = 'inactive';
    if (driver.subscription) {
        driver.subscription.status = 'inactive';
    }
    await driver.save();

    const details = `Transaction [${transaction._id}] de ${transaction.amount} FCFA rejetee. Motif: ${reason}`;
    await logSystemAction(validatorId, 'REJECT_SUBSCRIPTION', driver._id, details);
    
    try { await redisClient.del(`auth:user:${driver._id}`); } catch(e) {}
  } else {
    await logSystemAction(validatorId, 'REJECT_SUBSCRIPTION', transaction.user, `Transaction [${transaction._id}] rejetee (Chauffeur introuvable). Motif: ${reason}`);
  }
  
  return { transaction, driver };
};

const getDashboardStats = async () => {
  const [totalUsers, activeDrivers, pendingValidations, revenueData] = await Promise.all([
    User.countDocuments({ role: { $in: ['rider', 'driver'] } }),
    User.countDocuments({ role: 'driver', isAvailable: true }),
    Transaction.countDocuments({ status: 'PENDING' }),
    Transaction.aggregate([
      { $match: { status: 'APPROVED' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ])
  ]);

  return {
    totalUsers,
    activeDrivers,
    pendingValidations,
    totalRevenue: revenueData.length > 0 ? revenueData[0].total : 0
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

const getAllUsers = async (query, userRole) => {
  const page = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.min(50, parseInt(query.limit) || 20);
  const skip = (page - 1) * limit;

  const filter = {};
  if (userRole === 'admin') filter.role = { $ne: 'superadmin' };
  
  if (query.search) {
    const safeSearch = query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { name: new RegExp(safeSearch, 'i') },
      { email: new RegExp(safeSearch, 'i') }
    ];
  }

  const [users, total] = await Promise.all([
    User.find(filter).select('-password').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    User.countDocuments(filter)
  ]);

  return { users, pagination: { page, total, pages: Math.ceil(total / limit) } };
};

module.exports = {
  updateUserRole,
  toggleUserBan,
  updateMapSettings,
  approveTransaction,
  rejectTransaction,
  getDashboardStats,
  getFinanceData,
  togglePromo,
  updateWaveLinks,
  getAllUsers
};