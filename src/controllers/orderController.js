// src/controllers/orderController.js
const mongoose = require('mongoose');
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
      if (!product || product.isSoldOut) return next(new AppError(`Produit ${item.name || 'indéfini'} indisponible`, 400));
      
      if (product.manageStock && product.stockCount < item.quantity) {
        return next(new AppError(`Stock insuffisant pour ${product.name} (Disponible : ${product.stockCount})`, 400));
      }
      
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

    // Incrémentation atomique du nombre de ventes pour la popularité
    for (const item of validatedItems) {
      try {
        await Product.findByIdAndUpdate(item.product, { $inc: { salesCount: item.quantity } });
      } catch (err) {
        logger.error(`[ORDER POPULARITY] Échec incrémentation salesCount pour ${item.product}: ${err.message}`);
      }
    }

    const populatedOrder = await Order.findById(order._id).populate('customer seller');

    // TEMPS RÉEL
    const io = req.app.get('socketio');
    if (io) {
      io.to(sellerId.toString()).emit('new_order', populatedOrder);
    }

    // NOTIFICATIONS & EMAILS (Enveloppés pour éviter de bloquer la réponse client)
    try {
      await sendNotification(
        sellerId,
        'Nouvelle commande ! 🛍️',
        `Vous avez reçu une commande de ${(itemsPrice).toLocaleString()} F.`,
        'NEW_ORDER',
        { orderId: order._id.toString() }
      );

      await sendEmail({
        email: seller.email,
        subject: `[YELY] Nouvelle commande #${order._id.toString().slice(-6)}`,
        message: `Vous avez reçu une nouvelle commande de ${req.user.name}. Connectez-vous sur votre dashboard vendeur pour la valider.`
      });
    } catch (sideEffectError) {
      logger.error(`[ORDER SIDE-EFFECTS] Erreur non bloquante: ${sideEffectError.message}`);
    }

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
    const order = await Order.findById(req.params.id)
      .populate('customer seller driver')
      .populate('items.product');

    if (!order) return next(new AppError('Commande introuvable', 404));

    // Transitions et Notifications
    if (status === 'confirmed') {
      const isManualRetry = ['searching_delivery_retry', 'cancelled_no_driver'].includes(order.status);
      
      order.confirmedAt = Date.now();
      order.deliveryRetryCount = 0; // Réinitialise les tentatives de relance automatique
      
      await sendNotification(
        order.customer._id, 
        'Recherche de livreur relancée 🔄', 
        isManualRetry
          ? `${order.seller.name} relance la recherche d'un livreur pour votre commande.`
          : `${order.seller.name} prépare votre commande et recherche un livreur.`, 
        'ORDER_UPDATE', 
        { orderId: order._id }
      );

      // --- LOGIQUE DE DISPATCH LIVREUR (TRICHE SUR LES RIDES) ---
      try {
        const rideLifecycleService = require('../services/ride/rideLifecycleService');
        const redisClient = req.app.get('redis');

        const deliveryData = {
          origin: {
            address: order.seller.address || 'Point de retrait vendeur',
            coordinates: order.seller.currentLocation.coordinates
          },
          destination: {
            address: order.shippingAddress.address,
            coordinates: order.shippingAddress.coordinates
          },
          forfait: 'STANDARD',
          passengersCount: 1,
          type: 'DELIVERY', // Type spécial pour distinguer des taxis
          orderId: order._id // Référence croisée
        };

        const { ride } = await rideLifecycleService.createRideRequest(order.customer._id, deliveryData, redisClient);
        
        // On lie la livraison à la commande
        order.deliveryRideId = ride._id;
        logger.info(`[MARKETPLACE DISPATCH] Livraison créée pour commande ${order._id} : Ride ${ride._id}`);
      } catch (dispatchError) {
        logger.error(`[MARKETPLACE DISPATCH] Erreur lors de la création de la livraison : ${dispatchError.message}`);
      }
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

      // --- LOGIQUE DE DÉDUCTION DES STOCKS EN TEMPS RÉEL (SAUF NOURRITURE) ---
      // Seul le statut livré déduit définitivement le stock du produit.
      if (order.status !== 'delivered') {
        for (const item of order.items) {
          try {
            const product = await Product.findById(item.product);
            if (product && product.manageStock && product.category !== 'Food') {
              const currentStock = product.stockCount || 0;
              const newStock = Math.max(0, currentStock - item.quantity);
              
              product.stockCount = newStock;
              if (newStock === 0) {
                product.isSoldOut = true;
              }
              await product.save();
              
              logger.info(`[STOCK DEDUCTION] Produit ${product.name} (${product._id}) déduit de ${item.quantity}. Ancien stock: ${currentStock}, Nouveau stock: ${newStock}`);
              
              // Notification temps réel aux autres clients / clients connectés
              const io = req.app.get('socketio');
              if (io) {
                io.emit('product_updated', product);
              }
            }
          } catch (stockErr) {
            logger.error(`[STOCK DEDUCTION ERROR] Impossible de mettre à jour le stock pour le produit ${item.product}: ${stockErr.message}`);
          }
        }
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

exports.cancelOrder = async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return next(new AppError('Commande introuvable', 404));

    const cancelableStatuses = ['pending', 'searching', 'searching_delivery_retry', 'cancelled_no_driver'];
    if (!cancelableStatuses.includes(order.status)) {
      return next(new AppError('Impossible d\'annuler une commande déjà prise en charge ou livrée.', 400));
    }

    if (order.deliveryRideId) {
      try {
        const rideService = require('../services/ride/rideLifecycleService');
        // cancelRideAction s'occupera d'annuler la course ET la commande associée de manière unifiée
        await rideService.cancelRideAction(order.deliveryRideId, order.customer, 'rider', 'Commande annulée par le client');
        
        // On récupère la commande mise à jour par cancelRideAction
        const updatedOrder = await Order.findById(req.params.id).populate('customer seller driver');
        
        // Émettre la mise à jour via socket.io en temps réel pour notifier immédiatement le vendeur et le client
        const io = req.app.get('socketio');
        if (io) {
          io.to(updatedOrder.seller._id.toString()).emit('order_updated', updatedOrder);
          io.to(updatedOrder.customer._id.toString()).emit('order_updated', updatedOrder);
        }

        // Envoyer la notification push au vendeur
        await sendNotification(updatedOrder.seller._id, 'Commande annulée ⚠️', `Le client a annulé sa commande #${updatedOrder._id.toString().slice(-6)}`, 'ORDER_CANCELLED');

        return res.status(200).json({ success: true, data: updatedOrder });
      } catch (rideCancelError) {
        logger.error(`[CANCEL ORDER RIDE ERROR] Échec de l'annulation de la course associée : ${rideCancelError.message}`);
      }
    }

    order.status = 'cancelled';
    order.cancelledAt = Date.now();
    order.history.push({ status: 'cancelled', comment: 'Annulée par le client', timestamp: Date.now() });
    await order.save();

    const io = req.app.get('socketio');
    if (io) {
      io.to(order.seller.toString()).emit('order_updated', order);
      io.to(order.customer.toString()).emit('order_updated', order);
    }
    
    await sendNotification(order.seller, 'Commande annulée ⚠️', `Le client a annulé sa commande #${order._id.toString().slice(-6)}`, 'ORDER_CANCELLED');

    res.status(200).json({ success: true, data: order });
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
