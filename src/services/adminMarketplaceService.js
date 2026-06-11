// src/services/adminMarketplaceService.js
// SERVICE METIER - Administration Marketplace (Commandes, Stats et Grand Livre)
// STANDARD: Industriel / Bank Grade

const mongoose = require('mongoose');
const Order = require('../models/Order');
const Ledger = require('../models/Ledger');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const AppError = require('../utils/AppError');
const logger = require('../config/logger');

const getMarketplaceStats = async () => {
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

  return {
    totalSales: salesResult.length > 0 ? salesResult[0].total : 0,
    pendingOrdersCount,
    activeDeliveriesCount,
    totalLedgerDebt: ledgerResult.length > 0 ? ledgerResult[0].total : 0
  };
};

const getMarketplaceOrders = async (query) => {
  const page = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.min(50, parseInt(query.limit) || 20);
  const skip = (page - 1) * limit;

  const filter = {};
  if (query.status) {
    filter.status = query.status;
  }

  if (query.search) {
    const safeSearch = query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const searchRegex = new RegExp(safeSearch, 'i');
    
    if (mongoose.Types.ObjectId.isValid(query.search)) {
      filter._id = query.search;
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

  return {
    orders,
    pagination: { page, total, pages: Math.ceil(total / limit) }
  };
};

const overrideMarketplaceOrder = async (orderId, body, requesterId, requesterName, io) => {
  const { status, driverId, cancelRide, reason } = body;
  const order = await Order.findById(orderId).populate('customer seller driver');
  if (!order) {
    throw new AppError("Commande introuvable.", 404);
  }

  const oldStatus = order.status;
  const oldDriverName = order.driver?.name || 'aucun';

  if (cancelRide && order.deliveryRideId) {
    try {
      const rideLifecycleService = require('./ride/rideLifecycleService');
      await rideLifecycleService.cancelRideAction(
        order.deliveryRideId,
        requesterId,
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
        throw new AppError("Le livreur spécifié est invalide.", 400);
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
      comment: reason || `Statut forcé administrativement par ${requesterName || 'Admin'}`,
      timestamp: Date.now()
    });
  }

  await order.save();

  const updatedOrder = await Order.findById(orderId).populate('customer seller driver');
  if (io && updatedOrder) {
    io.to(updatedOrder.customer._id.toString()).emit('order_updated', updatedOrder);
    io.to(updatedOrder.seller._id.toString()).emit('order_updated', updatedOrder);
  }

  await AuditLog.create({
    actor: requesterId,
    action: 'OVERRIDE_MARKETPLACE_ORDER',
    target: order._id,
    details: `Override commande #${order._id.toString().slice(-6)}: Statut ${oldStatus} -> ${status || oldStatus}, Livreur ${oldDriverName} -> ${updatedOrder.driver?.name || 'aucun'}. Motif: ${reason || 'aucun'}`
  });

  return updatedOrder;
};

const getMarketplaceLedgers = async (query) => {
  const page = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.min(50, parseInt(query.limit) || 20);
  const skip = (page - 1) * limit;

  const filter = {};
  if (query.status) {
    filter.status = query.status;
  }

  if (query.search) {
    const safeSearch = query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

  return {
    ledgers,
    pagination: { page, total, pages: Math.ceil(total / limit) }
  };
};

const forceClearLedger = async (ledgerId, reason, requesterId, requesterName, io) => {
  const session = await mongoose.startSession();
  let resultLedger;

  try {
    await session.withTransaction(async () => {
      const ledger = await Ledger.findById(ledgerId).session(session);
      if (!ledger) {
        throw new Error("Ardoise introuvable.");
      }

      if (ledger.status === 'cleared') {
        throw new Error("Cette ardoise est déjà réconciliée.");
      }

      ledger.status = 'cleared';
      ledger.clearedAt = Date.now();
      ledger.note = reason || `Réconciliation forcée par le SuperAdmin ${requesterName || 'SuperAdmin'}`;
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

    if (io && resultLedger) {
      io.to(resultLedger.driver.toString()).emit('ledger_cleared', resultLedger);
      io.to(resultLedger.seller.toString()).emit('ledger_cleared', resultLedger);
    }

    await AuditLog.create({
      actor: requesterId,
      action: 'FORCE_CLEAR_LEDGER',
      target: resultLedger._id,
      details: `Réconciliation forcée de l'ardoise #${resultLedger._id.toString().slice(-6)} (Montant: ${resultLedger.amount} FCFA) pour le livreur ID: ${resultLedger.driver}. Raison: ${reason || 'non spécifiée'}`
    });

    return resultLedger;
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    await session.endSession();
    throw error;
  }
};

module.exports = {
  getMarketplaceStats,
  getMarketplaceOrders,
  overrideMarketplaceOrder,
  getMarketplaceLedgers,
  forceClearLedger
};
