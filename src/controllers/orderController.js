// src/controllers/orderController.js
// CONTROLLER COMMANDES - Flux Marketplace & Logistique
// STANDARD: Bank Grade (Intégrité des Transactions)

const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const Ledger = require('../models/Ledger');
const { sendNotification } = require('../services/notificationService');
const AppError = require('../utils/AppError');
const logger = require('../config/logger');
const { calculateDistance, calculateDeliveryPrice } = require('../utils/geoUtils');

/**
 * @desc    Créer une nouvelle commande
 * @route   POST /api/v1/orders
 * @access  Private (Rider)
 */
exports.createOrder = async (req, res, next) => {
  try {
    const { items, shippingAddress, sellerId } = req.body;

    if (!items || items.length === 0) {
      return next(new AppError('Le panier est vide', 400));
    }

    if (!shippingAddress || !shippingAddress.coordinates) {
      return next(new AppError('Adresse de livraison ou coordonnées manquantes', 400));
    }

    // Récupérer le vendeur pour avoir ses coordonnées
    const seller = await User.findById(sellerId);
    if (!seller || seller.role !== 'seller') {
      return next(new AppError('Vendeur introuvable ou invalide', 404));
    }

    let itemsPrice = 0;
    const validatedItems = [];

    // Validation des produits et prix
    for (const item of items) {
      const product = await Product.findById(item.product);
      if (!product || product.isSoldOut) {
        return next(new AppError(`Produit ${item.name || ''} indisponible`, 400));
      }
      
      const price = product.price;
      itemsPrice += price * item.quantity;
      
      validatedItems.push({
        product: product._id,
        name: product.name,
        quantity: item.quantity,
        price: price
      });
    }

    // Calcul de la distance et du prix de livraison
    const sellerCoords = seller.currentLocation?.coordinates || [0, 0];
    const buyerCoords = shippingAddress.coordinates;
    const distanceKm = calculateDistance(sellerCoords, buyerCoords);
    const calculatedDeliveryPrice = calculateDeliveryPrice(distanceKm);

    const totalPrice = itemsPrice + calculatedDeliveryPrice;

    const order = await Order.create({
      customer: req.user._id,
      seller: sellerId,
      items: validatedItems,
      itemsPrice,
      deliveryPrice: calculatedDeliveryPrice,
      totalPrice,
      shippingAddress,
      status: 'pending',
      history: [{ status: 'pending', comment: 'Commande effectuée' }]
    });

    // Notifier le vendeur
    await sendNotification(
      sellerId,
      'Nouvelle commande !',
      `Vous avez reçu une commande de ${totalPrice} FCFA.`,
      'MARKETPLACE_ORDER',
      { orderId: order._id.toString() }
    );

    res.status(201).json({ success: true, data: order });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Mettre à jour le statut de la commande (Transitions logiques)
 * @route   PATCH /api/v1/orders/:id/status
 * @access  Private (Seller/Driver)
 */
exports.updateOrderStatus = async (req, res, next) => {
  try {
    const { status, comment } = req.body;
    const order = await Order.findById(req.params.id).populate('customer seller driver');

    if (!order) return next(new AppError('Commande introuvable', 404));

    const oldStatus = order.status;

    // --- LOGIQUE DE TRANSITION DES ÉTATS ---
    
    // 1. Validation par le Vendeur
    if (status === 'confirmed' && req.user.role === 'seller') {
      order.confirmedAt = Date.now();
      await sendNotification(order.customer._id, 'Commande confirmée', 'Votre commande a été acceptée par le vendeur.', 'ORDER_UPDATE', { orderId: order._id });
    } 
    
    // 2. Ramassage par le Livreur
    else if (status === 'picked_up' && req.user.role === 'driver') {
      order.driver = req.user._id;
      order.pickedUpAt = Date.now();
      await sendNotification(order.customer._id, 'En cours de livraison', 'Le livreur a récupéré votre colis.', 'ORDER_UPDATE', { orderId: order._id });
      await sendNotification(order.seller._id, 'Colis récupéré', 'Le livreur est en route vers le client.', 'ORDER_UPDATE', { orderId: order._id });
    }

    // 3. Livraison Finale (Cash Encaissé)
    else if (status === 'delivered' && order.driver && order.driver._id.toString() === req.user._id.toString()) {
      order.deliveredAt = Date.now();
      
      // CRITIQUE: Mise à jour du Ledger (Ardoise de dettes)
      // Le livreur doit l'argent des produits au vendeur. L'argent de la livraison lui appartient.
      await Ledger.create({
        driver: order.driver._id,
        seller: order.seller._id,
        order: order._id,
        amount: order.itemsPrice,
        status: 'pending'
      });

      // Mise à jour de la dette cumulée sur le profil Driver
      await User.findByIdAndUpdate(order.driver._id, {
        $inc: { 'ledger.currentCashDebt': order.itemsPrice }
      });

      await sendNotification(order.customer._id, 'Commande livrée !', 'Merci de votre confiance. Bon appétit / Bonne utilisation !', 'ORDER_COMPLETE', { orderId: order._id });
      await sendNotification(order.seller._id, 'Livraison terminée', `Le livreur a encaissé ${order.totalPrice} FCFA. Une dette de ${order.itemsPrice} FCFA a été ajoutée à son ardoise.`, 'ORDER_COMPLETE', { orderId: order._id });
    }

    // 4. Refus ou Annulation
    else if (status === 'rejected' || status === 'cancelled') {
      order.cancelledAt = Date.now();
      const recipientId = (req.user.role === 'rider') ? order.seller._id : order.customer._id;
      await sendNotification(recipientId, 'Commande annulée/refusée', `Statut: ${status}. Raison: ${comment || 'Non spécifiée'}`, 'ORDER_CANCEL');
    }

    order.status = status;
    order.history.push({ status, comment, timestamp: Date.now() });
    await order.save();

    res.status(200).json({ success: true, data: order });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Récupérer les commandes du client connecté
 */
exports.getMyOrders = async (req, res, next) => {
  try {
    const orders = await Order.find({ customer: req.user._id }).sort('-createdAt').populate('seller driver');
    res.status(200).json({ success: true, data: orders });
  } catch (error) { next(error); }
};

/**
 * @desc    Récupérer les commandes reçues par un vendeur
 */
exports.getSellerOrders = async (req, res, next) => {
  try {
    const orders = await Order.find({ seller: req.user._id }).sort('-createdAt').populate('customer driver');
    res.status(200).json({ success: true, data: orders });
  } catch (error) { next(error); }
};
