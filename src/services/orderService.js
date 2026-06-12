// src/services/orderService.js
// SERVICE METIER - Logique e-commerce et orchestration logistique
// STANDARD: Industriel / Bank Grade

const mongoose = require('mongoose');
const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const Ledger = require('../models/Ledger');
const { sendNotification } = require('./notificationService');
const AppError = require('../utils/AppError');
const logger = require('../config/logger');

const { createOrder } = require('./orderCreationService');

const updateOrderStatus = async (orderId, status, comment, io, redisClient) => {
  const order = await Order.findById(orderId)
    .populate('customer seller driver')
    .populate('items.product');

  if (!order) throw new AppError('Commande introuvable', 404);

  if (status === 'confirmed') {
    order.confirmedAt = Date.now();
    await sendNotification(
      order.customer._id, 
      'Commande confirmée', 
      `${order.seller.name} prépare votre commande.`, 
      'ORDER_UPDATE', 
      { orderId: order._id }
    );
  } 
  else if (status === 'searching') {
    const isManualRetry = ['searching_delivery_retry', 'cancelled_no_driver'].includes(order.status);
    order.deliveryRetryCount = 0; 
    
    await sendNotification(
      order.customer._id, 
      'Recherche de livreur lancée', 
      isManualRetry
        ? `${order.seller.name} relance la recherche d'un livreur pour votre commande.`
        : `Votre commande est prête. Recherche d'un livreur disponible.`, 
      'ORDER_UPDATE', 
      { orderId: order._id }
    );

    try {
      console.log(`[DISPATCH DEBUG] Début du dispatch de livraison pour la commande : ${order._id}`);
      const rideLifecycleService = require('./ride/rideLifecycleService');
      const rideHelpers = require('./ride/rideHelpers');
      const uniqueSellersMap = new Map();
      
      let sellerCoords = order.seller.currentLocation?.coordinates;
      if (!sellerCoords || (sellerCoords[0] === 0 && sellerCoords[1] === 0)) {
        sellerCoords = await rideHelpers.resolveCoordsFromAddress(order.seller.address, order.seller.name, redisClient);
      }
      console.log(`[DISPATCH DEBUG] Coordonnées Vendeur résolues : ${JSON.stringify(sellerCoords)}`);
      console.log(`[DISPATCH DEBUG] Coordonnées Client : ${JSON.stringify(order.shippingAddress.coordinates)}`);

      uniqueSellersMap.set(order.seller._id.toString(), {
        seller: order.seller._id,
        address: order.seller.address || 'Point de retrait vendeur',
        coordinates: sellerCoords,
        isCollected: false
      });

      for (const item of order.items) {
        if (item.product && item.product.seller) {
          const sId = (item.product.seller._id || item.product.seller).toString();
          if (!uniqueSellersMap.has(sId)) {
            const secondarySeller = await User.findById(item.product.seller._id || item.product.seller);
            if (secondarySeller) {
              let secCoords = secondarySeller.currentLocation?.coordinates;
              if (!secCoords || (secCoords[0] === 0 && secCoords[1] === 0)) {
                secCoords = await rideHelpers.resolveCoordsFromAddress(secondarySeller.address, secondarySeller.name, redisClient);
              }
              uniqueSellersMap.set(sId, {
                seller: secondarySeller._id,
                address: secondarySeller.address || 'Point de retrait vendeur secondaire',
                coordinates: secCoords,
                isCollected: false
              });
            }
          }
        }
      }

      const collectionPoints = Array.from(uniqueSellersMap.values());

      const deliveryData = {
        origin: {
          address: order.seller.address || 'Point de retrait vendeur',
          coordinates: sellerCoords
        },
        destination: {
          address: order.shippingAddress.address,
          coordinates: order.shippingAddress.coordinates
        },
        forfait: 'STANDARD',
        passengersCount: 1,
        type: 'DELIVERY', 
        orderId: order._id, 
        deliveryPrice: order.deliveryPrice,
        collectionPoints
      };

      const { ride, drivers } = await rideLifecycleService.createRideRequest(order.customer._id, deliveryData, redisClient);
      order.deliveryRideId = ride._id;
      logger.info(`[MARKETPLACE DISPATCH] Livraison créée pour commande ${order._id} : Ride ${ride._id}. ${drivers.length} livreurs ciblés.`);

      if (drivers && drivers.length > 0 && io) {
        drivers.forEach(driver => {
          io.to(driver._id.toString()).emit('new_ride_request', {
            rideId: ride._id,
            origin: ride.origin,       
            destination: ride.destination, 
            distance: ride.distance,
            forfait: ride.forfait,
            passengersCount: ride.passengersCount,
            priceOptions: ride.priceOptions,
            riderName: order.customer.name,
            riderProfilePicture: order.customer.profilePicture,
            collectionPoints: ride.collectionPoints,
            type: 'DELIVERY'
          });
        });
      }
    } catch (dispatchError) {
      console.error("[DISPATCH DEBUG CRITICAL ERROR] Échec complet de la création de course :", dispatchError);
      logger.error(`[MARKETPLACE DISPATCH] Erreur lors de la création de la livraison : ${dispatchError.message}`);
    }
  }
  else if (status === 'rejected') {
    await sendNotification(
      order.customer._id, 
      'Commande refusée', 
      `${order.seller.name} ne peut pas honorer votre commande : ${comment || 'Indisponible'}`, 
      'ORDER_UPDATE', 
      { orderId: order._id }
    );
  }
  else if (status === 'delivered') {
    order.deliveredAt = Date.now();
    if (order.driver) {
      const sellerAmounts = new Map();
      for (const item of order.items) {
        const sellerId = item.product && item.product.seller
          ? (item.product.seller._id || item.product.seller).toString()
          : order.seller._id.toString();
        
        const itemTotal = item.price * item.quantity;
        sellerAmounts.set(sellerId, (sellerAmounts.get(sellerId) || 0) + itemTotal);
      }

      const ledgerEntries = [];
      for (const [sellerId, amount] of sellerAmounts.entries()) {
        ledgerEntries.push({
          driver: order.driver._id,
          seller: sellerId,
          order: order._id,
          amount: amount,
          status: 'pending',
          note: `Création automatique (Manuel) suite à la livraison réussie de la commande`
        });
      }
      await Ledger.create(ledgerEntries);

      const driverDoc = await User.findById(order.driver._id);
      if (driverDoc) {
        driverDoc.ledger = driverDoc.ledger || {};
        driverDoc.ledger.currentCashDebt = (driverDoc.ledger.currentCashDebt || 0) + order.itemsPrice;
        
        if (driverDoc.ledger.currentCashDebt >= (driverDoc.ledger.maxCashDebt || 50000)) {
          driverDoc.ledger.isBlocked = true;
          logger.warn(`[SECURITY] Livreur ${driverDoc.email} bloqué automatiquement suite à dépassement de la dette maximale.`);
        }
        await driverDoc.save();
      }
    }

    if (order.status !== 'delivered') {
      for (const item of order.items) {
        try {
          const product = await Product.findById(item.product);
          if (product && product.manageStock && product.category !== 'Food') {
            const currentStock = product.stockCount || 0;
            const newStock = Math.max(0, currentStock - item.quantity);
            
            product.stockCount = newStock;
            if (newStock === 0) product.isSoldOut = true;
            await product.save();
            
            logger.info(`[STOCK DEDUCTION] Produit ${product.name} (${product._id}) déduit de ${item.quantity}. Ancien: ${currentStock}, Nouveau: ${newStock}`);
            
            if (io) io.emit('product_updated', product);
          }
        } catch (stockErr) {
          logger.error(`[STOCK DEDUCTION ERROR] Impossible de mettre à jour le stock : ${stockErr.message}`);
        }
      }
    }

    await sendNotification(
      order.customer._id, 
      'Commande livrée', 
      'Votre commande a été livrée. Merci de votre confiance !', 
      'ORDER_COMPLETE', 
      { orderId: order._id }
    );
  }

  order.status = status;
  order.history.push({ status, comment, timestamp: Date.now() });
  await order.save();

  if (io) {
    io.to(order.customer._id.toString()).emit('order_updated', order);
    io.to(order.seller._id.toString()).emit('order_updated', order);
  }

  return order;
};

const cancelOrder = async (orderId, customerUser, io) => {
  const order = await Order.findById(orderId);
  if (!order) throw new AppError('Commande introuvable', 404);

  const cancelableStatuses = ['pending', 'searching', 'searching_delivery_retry', 'cancelled_no_driver'];
  if (!cancelableStatuses.includes(order.status)) {
    throw new AppError('Impossible d\'annuler une commande déjà prise en charge ou livrée.', 400);
  }

  if (order.deliveryRideId) {
    const rideLifecycleService = require('./ride/rideLifecycleService');
    await rideLifecycleService.cancelRideAction(order.deliveryRideId, customerUser, 'rider', 'Commande annulée par le client', io);
    
    const updatedOrder = await Order.findById(orderId).populate('customer seller driver');
    
    if (io) {
      io.to(updatedOrder.seller._id.toString()).emit('order_updated', updatedOrder);
      io.to(updatedOrder.customer._id.toString()).emit('order_updated', updatedOrder);
    }

    await sendNotification(updatedOrder.seller._id, 'Commande annulée', `Le client a annulé sa commande #${updatedOrder._id.toString().slice(-6)}`, 'ORDER_CANCELLED');
    return updatedOrder;
  }

  order.status = 'cancelled';
  order.cancelledAt = Date.now();
  order.history.push({ status: 'cancelled', comment: 'Annulée par le client', timestamp: Date.now() });
  await order.save();

  if (io) {
    io.to(order.seller.toString()).emit('order_updated', order);
    io.to(order.customer.toString()).emit('order_updated', order);
  }
  
  await sendNotification(order.seller, 'Commande annulée', `Le client a annulé sa commande #${order._id.toString().slice(-6)}`, 'ORDER_CANCELLED');
  return order;
};

module.exports = {
  createOrder,
  updateOrderStatus,
  cancelOrder
};
