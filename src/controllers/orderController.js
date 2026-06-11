// src/controllers/orderController.js
// CONTROLLER COMMANDE - Exposition des Endpoints HTTP
// STANDARD: Industriel / Bank Grade (Délégation de logique active)

const mongoose = require('mongoose');
const Order = require('../models/Order');
const AppError = require('../utils/AppError');
const logger = require('../config/logger');
const orderService = require('../services/orderService');

exports.createOrder = async (req, res, next) => {
  try {
    const io = req.app.get('socketio');
    const populatedOrder = await orderService.createOrder(
      req.user._id,
      req.user.name,
      req.body,
      io
    );
    res.status(201).json({ success: true, data: populatedOrder });
  } catch (error) {
    next(error);
  }
};

exports.updateOrderStatus = async (req, res, next) => {
  try {
    const { status, comment } = req.body;
    const io = req.app.get('socketio');
    const redisClient = req.app.get('redis');
    
    const order = await orderService.updateOrderStatus(
      req.params.id,
      status,
      comment,
      io,
      redisClient
    );
    res.status(200).json({ success: true, data: order });
  } catch (error) {
    next(error);
  }
};

exports.cancelOrder = async (req, res, next) => {
  try {
    const io = req.app.get('socketio');
    const order = await orderService.cancelOrder(req.params.id, req.user, io);
    res.status(200).json({ success: true, data: order });
  } catch (error) {
    next(error);
  }
};

exports.getMyOrders = async (req, res, next) => {
  try {
    const orders = await Order.find({ customer: req.user._id })
      .sort('-createdAt')
      .populate('seller driver')
      .populate('items.product');
    res.status(200).json({ success: true, data: orders });
  } catch (error) { next(error); }
};

exports.getSellerOrders = async (req, res, next) => {
  try {
    const sellerId = new mongoose.Types.ObjectId(req.user._id);
    logger.info(`[MARKETPLACE] Fetching orders for seller: ${sellerId}`);
    const orders = await Order.find({ seller: sellerId })
      .sort('-createdAt')
      .populate('customer driver')
      .populate('items.product');
    logger.info(`[MARKETPLACE] Orders found for seller ${sellerId}: ${orders.length}`);
    res.status(200).json({ success: true, data: orders });
  } catch (error) { next(error); }
};

exports.getOrder = async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('customer seller driver')
      .populate('items.product');
    if (!order) return next(new AppError('Commande introuvable', 404));
    res.status(200).json({ success: true, data: order });
  } catch (error) { next(error); }
};
