// src/controllers/orderController.js
const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const Ledger = require('../models/Ledger');
const { sendNotification } = require('../services/notificationService');
const { sendEmail } = require('../utils/emailService');
const AppError = require('../utils/AppError');
const logger = require('../config/logger');
const { calculateDistance, calculateDeliveryPrice } = require('../utils/geoUtils');

/**
 * @desc    Créer une nouvelle commande
 */
exports.createOrder = async (req, res, next) => {
  try {
    const { items, shippingAddress, sellerId, paymentMethod = 'Cash' } = req.body;

    if (!items || items.length === 0) return next(new AppError('Le panier est vide', 400));

    const seller = await User.findById(sellerId);
    if (!seller) return next(new AppError('Vendeur introuvable', 404));

    let itemsPrice = 0;
    const validatedItems = [];

    for (const item of items) {
      const product = await Product.findById(item.product || item.id);
      if (!product || product.isSoldOut) return next(new AppError(`Produit ${item.name} indisponible`, 400));
      
      itemsPrice += product.price * item.quantity;
      validatedItems.push({
        product: product._id,
        name: product.name,
        quantity: item.quantity,
        price: product.price
      });
    }

    // CALCUL DE LIVRAISON (Forfait Ville: 100F base + 50F par vendeur extra, max 300F)
    // CALCUL DE LIVRAISON (Forfait Ville: 100F base + 50F par vendeur extra, max 300F)
    const uniqueSellers = new Set(items.map(item => (item.sellerId || sellerId).toString()));
    const nbSellers = uniqueSellers.size;
    
    let deliveryPrice = 100 + (nbSellers - 1) * 50;
    
    // Plafond de sécurité (Max 300F)
    if (deliveryPrice > 300) deliveryPrice = 300;

    const totalPrice = itemsPrice + deliveryPrice;
    
    logger.info(`[ORDER] Calc: Vendeurs=${nbSellers}, Livraison=${deliveryPrice}F, Total=${totalPrice}F`);

    const order = await Order.create({
      customer: req.user._id,
      seller: sellerId,
      items: validatedItems,
      itemsPrice,
      deliveryPrice,
      totalPrice,
      shippingAddress,
      paymentMethod,
      status: 'pending',
      history: [{ status: 'pending', comment: 'Commande effectuée' }]
    });

    const populatedOrder = await Order.findById(order._id).populate('customer seller');

    // TEMPS RÉEL
    const io = req.app.get('socketio');
    if (io) {
      io.to(sellerId.toString()).emit('new_order', populatedOrder);
    }

    // NOTIFICATIONS
    await sendNotification(
      sellerId,
      'Nouvelle commande ! 🛍️',
      `Vous avez reçu une commande de ${(itemsPrice).toLocaleString()} F.`,
      'NEW_ORDER',
      { orderId: order._id.toString() }
    );

    // EMAIL AU VENDEUR
    await sendEmail({
      email: seller.email,
      subject: `[YELY] Nouvelle commande #${order._id.toString().slice(-6)}`,
      message: `Vous avez reçu une nouvelle commande de ${req.user.name}. Connectez-vous sur votre dashboard vendeur pour la valider.`
    });

    res.status(201).json({ success: true, data: populatedOrder });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Mettre à jour le statut de la commande
 */
exports.updateOrderStatus = async (req, res, next) => {
  try {
    const { status, comment } = req.body;
    const order = await Order.findById(req.params.id).populate('customer seller driver');

    if (!order) return next(new AppError('Commande introuvable', 404));

    // Transitions et Notifications
    if (status === 'confirmed') {
      order.confirmedAt = Date.now();
      await sendNotification(order.customer._id, 'Commande confirmée ✅', `${order.seller.name} prépare votre commande.`, 'ORDER_UPDATE', { orderId: order._id });
    } 
    else if (status === 'rejected') {
      await sendNotification(order.customer._id, 'Commande refusée ❌', `${order.seller.name} ne peut pas honorer votre commande : ${comment || 'Indisponible'}`, 'ORDER_UPDATE', { orderId: order._id });
    }
    else if (status === 'delivered') {
      order.deliveredAt = Date.now();
      if (order.driver) {
        await Ledger.create({
          driver: order.driver._id,
          seller: order.seller._id,
          order: order._id,
          amount: order.itemsPrice,
          status: 'pending'
        });
      }
      await sendNotification(order.customer._id, 'Livrée ! 🎉', 'Votre commande a été livrée. Merci de votre confiance !', 'ORDER_COMPLETE', { orderId: order._id });
    }

    order.status = status;
    order.history.push({ status, comment, timestamp: Date.now() });
    await order.save();

    // TEMPS RÉEL UPDATE
    const io = req.app.get('socketio');
    if (io) {
      io.to(order.customer._id.toString()).emit('order_updated', order);
      io.to(order.seller._id.toString()).emit('order_updated', order);
    }

    res.status(200).json({ success: true, data: order });
  } catch (error) {
    next(error);
  }
};

exports.getMyOrders = async (req, res, next) => {
  try {
    const orders = await Order.find({ customer: req.user._id }).sort('-createdAt').populate('seller driver');
    res.status(200).json({ success: true, data: orders });
  } catch (error) { next(error); }
};

exports.getSellerOrders = async (req, res, next) => {
  try {
    const orders = await Order.find({ seller: req.user._id }).sort('-createdAt').populate('customer driver');
    res.status(200).json({ success: true, data: orders });
  } catch (error) { next(error); }
};

exports.getOrder = async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id).populate('customer seller driver');
    if (!order) return next(new AppError('Commande introuvable', 404));
    res.status(200).json({ success: true, data: order });
  } catch (error) { next(error); }
};
