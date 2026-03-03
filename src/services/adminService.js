// src/services/adminService.js
// LOGIQUE DE GOUVERNANCE - Transactions ACID & Invalidation Cache Dynamique
// CSCSM Level: Bank Grade

const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Settings = require('../models/Settings');
const AuditLog = require('../models/AuditLog');
const AppError = require('../utils/AppError');
const mongoose = require('mongoose');
const redisClient = require('../config/redis');

const logSystemAction = async (actorId, action, targetId, details, session) => {
  await AuditLog.create([{
    actor: actorId,
    action,
    target: targetId,
    details
  }], { session });
};

const updateUserRole = async (userId, action, requesterId, session) => {
  if (userId === requesterId.toString()) throw new AppError('Auto-promotion interdite.', 403);

  const user = await User.findById(userId).session(session);
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
  await user.save({ session });

  await logSystemAction(requesterId, `${action}_USER`, user._id, `De ${oldRole} vers ${user.role}`, session);
  await redisClient.del(`auth:user:${user._id}`);
  
  return { email: user.email, newRole: user.role };
};

const toggleUserBan = async (userId, reason, requesterId) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const user = await User.findById(userId).session(session);
    if (!user || user.role === 'superadmin') throw new AppError('Action impossible.', 403);

    user.isBanned = !user.isBanned;
    user.banReason = user.isBanned ? reason : '';
    if (user.isBanned) user.isAvailable = false;
    await user.save({ session });

    await logSystemAction(requesterId, user.isBanned ? 'BAN_USER' : 'UNBAN_USER', user._id, reason, session);
    await session.commitTransaction();
    await redisClient.del(`auth:user:${user._id}`);
    
    return user;
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

const updateMapSettings = async (data, requesterId) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    let settings = await Settings.findOne().session(session);
    if (!settings) settings = new Settings();

    settings.isMapLocked = data.isMapLocked;
    settings.serviceCity = data.serviceCity;
    settings.allowedRadiusKm = data.radius;
    settings.allowedCenter = { type: 'Point', coordinates: data.allowedCenter.coordinates };
    settings.updatedBy = requesterId;

    await settings.save({ session });
    await logSystemAction(requesterId, 'UPDATE_MAP_SETTINGS', settings._id, `Ville: ${data.serviceCity}`, session);
    
    await session.commitTransaction();
    return settings;
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

const approveTransaction = async (transactionId, validatorId, session) => {
  const transaction = await Transaction.findOne({ _id: transactionId, status: 'PENDING' }).session(session);
  if (!transaction) throw new AppError('Transaction invalide ou deja traitee.', 404);

  const driver = await User.findById(transaction.driver).session(session);
  if (!driver) throw new AppError('Chauffeur introuvable.', 404);

  const hoursToAdd = transaction.type === 'WEEKLY' ? 168 : 720;
  driver.subscription.isActive = true;
  driver.subscription.hoursRemaining += hoursToAdd;
  await driver.save({ session });

  transaction.status = 'APPROVED';
  transaction.validatedBy = validatorId;
  await transaction.save({ session });

  await logSystemAction(validatorId, 'APPROVE_PAYMENT', transaction._id, `+${hoursToAdd}h pour ${driver.email}`, session);
  return { transaction, driver, hoursToAdd };
};

const rejectTransaction = async (transactionId, reason, validatorId, session) => {
  const transaction = await Transaction.findOne({ _id: transactionId, status: 'PENDING' }).session(session);
  if (!transaction) throw new AppError('Transaction invalide ou deja traitee.', 404);

  transaction.status = 'REJECTED';
  transaction.rejectionReason = reason;
  transaction.validatedBy = validatorId;
  await transaction.save({ session });

  await logSystemAction(validatorId, 'REJECT_PAYMENT', transaction._id, `Raison: ${reason}`, session);
  return { transaction };
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
    { $group: { _id: '$type', totalAmount: { $sum: '$amount' }, count: { $sum: 1 } } }
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