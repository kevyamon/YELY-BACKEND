// src/services/ride/rideDeliveryRetryService.js
// SERVICE METIER - Logique de relance automatique de recherche de livreurs (Retry Dispatch)
// STANDARD: Industriel / Bank Grade

const Order = require('../../models/Order');
const User = require('../../models/User');
const notificationService = require('../notificationService');
const logger = require('../../config/logger');

const retryDeliverySearch = async (io, orderId) => {
  try {
    const order = await Order.findById(orderId).populate('customer seller');
    if (!order) {
      logger.error(`[DELIVERY RETRY] Commande ${orderId} introuvable.`);
      return;
    }

    if (order.status !== 'searching_delivery_retry') {
      logger.info(`[DELIVERY RETRY] Commande ${orderId} n'est plus en attente de retry (statut actuel: ${order.status}). Relance annulée.`);
      return;
    }

    order.status = 'searching';
    order.history.push({
      status: 'searching',
      comment: `Relance automatique de la recherche de livreur (Tentative ${order.deliveryRetryCount + 1}/3)`,
      timestamp: Date.now()
    });
    await order.save();

    logger.info(`[DELIVERY RETRY] Relance de la recherche de livreur pour la commande ${order._id}`);

    const rideHelpers = require('./rideHelpers');
    const uniqueSellersMap = new Map();
    
    let sellerCoords = order.seller.currentLocation?.coordinates;
    if (!sellerCoords || (sellerCoords[0] === 0 && sellerCoords[1] === 0)) {
      sellerCoords = await rideHelpers.resolveCoordsFromAddress(order.seller.address, order.seller.name, redis);
    }

    uniqueSellersMap.set(order.seller._id.toString(), {
      seller: order.seller._id,
      address: order.seller.address || 'Point de retrait vendeur',
      coordinates: sellerCoords,
      isCollected: false
    });

    for (const item of order.items) {
      if (item.product && item.product.seller) {
        const sId = item.product.seller._id.toString();
        if (!uniqueSellersMap.has(sId)) {
          const secondarySeller = await User.findById(item.product.seller._id || item.product.seller);
          if (secondarySeller) {
            let secCoords = secondarySeller.currentLocation?.coordinates;
            if (!secCoords || (secCoords[0] === 0 && secCoords[1] === 0)) {
              secCoords = await rideHelpers.resolveCoordsFromAddress(secondarySeller.address, secondarySeller.name, redis);
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

    const redis = require('../../config/redis');
    const rideLifecycleService = require('./rideLifecycleService');
    const { ride, drivers } = await rideLifecycleService.createRideRequest(order.customer._id, deliveryData, redis);
    
    order.deliveryRideId = ride._id;
    await order.save();

    notificationService.sendNotification(
      order.seller._id,
      'Recherche de livreur relancée',
      `Nous recherchons à nouveau un livreur pour votre commande #${order._id.toString().slice(-6)}.`,
      'ORDER_UPDATE',
      { orderId: order._id.toString() }
    ).catch(() => {});

    if (drivers && drivers.length > 0 && io) {
      const customer = await User.findById(order.customer).select('name profilePicture');
      drivers.forEach(driver => {
        io.to(driver._id.toString()).emit('new_ride_request', {
          rideId: ride._id,
          origin: ride.origin,       
          destination: ride.destination, 
          distance: ride.distance,
          forfait: ride.forfait,
          passengersCount: ride.passengersCount,
          priceOptions: ride.priceOptions,
          riderName: customer?.name || 'Client',
          riderProfilePicture: customer?.profilePicture,
          collectionPoints: ride.collectionPoints,
          type: 'DELIVERY'
        });
      });
    }
  } catch (error) {
    logger.error(`[DELIVERY RETRY ERROR] Erreur lors du retry : ${error.message}`);
  }
};

module.exports = {
  retryDeliverySearch
};
