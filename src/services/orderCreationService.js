// src/services/orderCreationService.js
// SERVICE METIER - Logique de création de commande e-commerce
// STANDARD: Industriel / Bank Grade

const mongoose = require('mongoose');
const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const { sendNotification } = require('./notificationService');
const { sendEmail } = require('../utils/emailService');
const AppError = require('../utils/AppError');
const logger = require('../config/logger');

const createOrder = async (customerId, customerName, orderData, io) => {
  const { items, sellerId, shippingAddress, paymentMethod = 'Cash' } = orderData;

  if (!items || items.length === 0) throw new AppError('Le panier est vide', 400);

  const seller = await User.findById(sellerId);
  if (!seller) throw new AppError('Vendeur introuvable', 404);

  let itemsPrice = 0;
  const validatedItems = [];

  for (const item of items) {
    const product = await Product.findById(item.product || item.id);
    if (!product || product.isSoldOut) {
      throw new AppError(`Produit ${item.name || 'indéfini'} indisponible`, 400);
    }
    
    if (product.manageStock && product.stockCount < item.quantity) {
      throw new AppError(`Stock insuffisant pour ${product.name} (Disponible : ${product.stockCount})`, 400);
    }
    
    itemsPrice += product.price * item.quantity;
    validatedItems.push({
      product: product._id,
      name: product.name,
      quantity: item.quantity,
      price: product.price
    });
  }

  const uniqueSellers = new Set(items.map(item => (item.sellerId || sellerId).toString()));
  const nbSellers = uniqueSellers.size;
  let deliveryPrice = 100 + (nbSellers - 1) * 50;
  if (deliveryPrice > 300) deliveryPrice = 300;

  const totalPrice = itemsPrice + deliveryPrice;
  logger.info(`[ORDER] Calc: Vendeurs=${nbSellers}, Livraison=${deliveryPrice}F, Total=${totalPrice}F`);

  const order = await Order.create({
    customer: customerId,
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

  for (const item of validatedItems) {
    try {
      await Product.findByIdAndUpdate(item.product, { $inc: { salesCount: item.quantity } });
    } catch (err) {
      logger.error(`[ORDER POPULARITY] Échec incrémentation salesCount pour ${item.product}: ${err.message}`);
    }
  }

  const populatedOrder = await Order.findById(order._id).populate('customer seller');

  if (io) {
    io.to(sellerId.toString()).emit('new_order', populatedOrder);
  }

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
      message: `Vous avez reçu une nouvelle commande de ${customerName}. Connectez-vous sur votre dashboard vendeur pour la valider.`
    });
  } catch (sideEffectError) {
    logger.error(`[ORDER SIDE-EFFECTS] Erreur non bloquante: ${sideEffectError.message}`);
  }

  return populatedOrder;
};

module.exports = {
  createOrder
};
