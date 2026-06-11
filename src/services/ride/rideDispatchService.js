// src/services/ride/rideDispatchService.js
// SERVICE METIER - Dispatch, attribution et extension geographique de la recherche
// STANDARD: Industriel / Bank Grade

const { Queue } = require('bullmq');
const Ride = require('../../models/Ride');
const User = require('../../models/User');
const userRepository = require('../../repositories/userRepository');
const notificationService = require('../notificationService');
const logger = require('../../config/logger');
const { env } = require('../../config/env');

const rideDeliveryRetryService = require('./rideDeliveryRetryService');

const cleanupQueue = new Queue('ride-cleanup', { 
  connection: { url: env.REDIS_URL } 
});

const dispatchToNearbyDrivers = async (ride, radius) => {
  const originCoords = ride.origin.coordinates;
  const excludedDrivers = [...(ride.rejectedDrivers || []), ...(ride.notifiedDrivers || [])];

  const drivers = await userRepository.findAvailableDriversNear(
    originCoords,
    radius,
    ride.forfait,
    excludedDrivers,
    ride.type
  );

  if (drivers.length > 0) {
    logger.info(`[DISPATCH] ${drivers.length} nouveaux chauffeurs trouves dans un rayon de ${radius}m pour la course ${ride._id}.`);

    const driverIds = drivers.map(d => d._id);
    await Ride.findByIdAndUpdate(ride._id, { $addToSet: { notifiedDrivers: { $each: driverIds } } });

    drivers.forEach(driver => {
      notificationService.sendNotification(
        driver._id,
        ride.type === 'DELIVERY' ? 'Nouvelle demande de livraison' : 'Nouvelle demande de course',
        ride.type === 'DELIVERY'
          ? `Livraison de ${ride.distance} km disponible à proximité.`
          : `Course de ${ride.distance} km disponible à proximité.`,
        'NEW_RIDE_REQUEST',
        { rideId: ride._id.toString() }
      ).catch(err => logger.error(`[PUSH ERROR] Echec d'envoi au chauffeur ${driver._id}: ${err.message}`));
    });
  }

  return drivers;
};

const expandSearchRadius = async (io, rideId) => {
  const ride = await Ride.findOne({ _id: rideId, status: 'searching' });
  if (!ride) return; 

  const initialRadius = 1000;
  const maxRadius = 2500; 
  const step = 300;

  let nextRadius = (ride.currentSearchRadius || initialRadius) + step;

  if (nextRadius > maxRadius) {
    return; 
  }

  ride.currentSearchRadius = nextRadius;
  await ride.save();

  io.to(ride.rider.toString()).emit('search_expanded', { radius: nextRadius });
  logger.info(`[DISPATCH] Agrandissement du rayon a ${nextRadius}m pour la course ${rideId}`);
  
  const drivers = await dispatchToNearbyDrivers(ride, nextRadius);

  if (drivers.length > 0) {
    const rider = await User.findById(ride.rider).select('name profilePicture');
    drivers.forEach(driver => {
      io.to(driver._id.toString()).emit('new_ride_request', {
        rideId: ride._id,
        origin: ride.origin,       
        destination: ride.destination, 
        distance: ride.distance,
        forfait: ride.forfait,
        passengersCount: ride.passengersCount,
        priceOptions: ride.priceOptions,
        riderName: rider?.name,
        riderProfilePicture: rider?.profilePicture,
        collectionPoints: ride.collectionPoints,
        type: ride.type
      });

      notificationService.sendNotification(
        driver._id,
        ride.type === 'DELIVERY' ? 'Nouvelle demande de livraison' : 'Nouvelle demande de course',
        ride.type === 'DELIVERY'
          ? `Livraison de ${ride.distance} km disponible à proximité.`
          : `Course de ${ride.distance} km disponible à proximité.`,
        'NEW_RIDE_REQUEST',
        { rideId: ride._id.toString() }
      ).catch(err => logger.error(`[PUSH ERROR] Echec d'envoi au chauffeur ${driver._id}: ${err.message}`));
    });
  } 

  if (nextRadius === maxRadius) {
    logger.info(`[DISPATCH] Rayon MAX atteint (${maxRadius}m) pour ${rideId}. Sablier de mort lance (60s).`);
    await cleanupQueue.add(
      'check-search-timeout',
      { rideId: ride._id },
      { delay: 60000, removeOnComplete: true }
    );
  } else {
    await cleanupQueue.add(
      'expand-search',
      { rideId: ride._id },
      { delay: 30000, removeOnComplete: true }
    );
  }
};

const cancelSearchTimeout = async (io, rideId) => {
  const ride = await Ride.findOne({ _id: rideId, status: 'searching' });
  if (ride) {
    ride.status = 'cancelled';
    ride.cancellationReason = 'Temps de recherche expiré, aucun chauffeur trouvé.';
    await ride.save();
    
    const isDelivery = ride.type === 'DELIVERY';
    
    io.to(ride.rider.toString()).emit('search_timeout', {
      message: isDelivery 
        ? "Aucun livreur n'est disponible pour le moment."
        : "Aucun chauffeur n'est disponible pour le moment."
    });

    notificationService.sendNotification(
      ride.rider, 
      "Recherche expirée", 
      isDelivery 
        ? "Aucun livreur n'est disponible dans votre zone pour le moment."
        : "Aucun chauffeur n'est disponible dans votre zone pour le moment.", 
      "SEARCH_TIMEOUT", 
      { rideId: ride._id.toString() }
    ).catch(() => {});
    
    io.emit('ride_taken_by_other', { rideId }); 

    try {
      const poiController = require('../../controllers/poiController');
      if (ride.origin?.address) await poiController.releasePendingPOI(ride.origin.address, io);
      if (ride.destination?.address) await poiController.releasePendingPOI(ride.destination.address, io);
    } catch (error) {
      logger.warn(`[POI RELEASE ERROR] Echec lors de la destruction de la course : ${error.message}`);
    }

    if (isDelivery && ride.orderId) {
      try {
        const Order = require('../../models/Order');
        const order = await Order.findById(ride.orderId).populate('seller customer');
        if (order && (order.status === 'confirmed' || order.status === 'searching')) {
          const currentRetries = order.deliveryRetryCount || 0;
          if (currentRetries < 2) {
            order.deliveryRetryCount = currentRetries + 1;
            order.status = 'searching_delivery_retry';
            order.history.push({
              status: 'searching_delivery_retry',
              comment: `Recherche de livreur infructueuse (Tentative ${currentRetries + 1}/3). Nouvelle tentative automatique dans 2 minutes.`,
              timestamp: Date.now()
            });
            await order.save();

            logger.info(`[DELIVERY RETRY] Commande ${order._id} bascule en searching_delivery_retry. Tentative ${order.deliveryRetryCount}/3 dans 2 minutes.`);

            notificationService.sendNotification(
              order.seller._id,
              'Recherche de livreur infructueuse 🚴',
              `Aucun livreur trouvé pour la commande #${order._id.toString().slice(-6)}. Yély relance automatiquement une nouvelle recherche dans 2 minutes.`,
              'ORDER_UPDATE',
              { orderId: order._id.toString() }
            ).catch(() => {});

            notificationService.sendNotification(
              order.customer._id,
              'Recherche de livreur en cours ⏳',
              `Nous élargissons nos recherches pour trouver un livreur disponible pour votre commande chez ${order.seller.name}.`,
              'ORDER_UPDATE',
              { orderId: order._id.toString() }
            ).catch(() => {});

            if (io) {
              io.to(order.seller._id.toString()).emit('order_updated', order);
              io.to(order.customer._id.toString()).emit('order_updated', order);
            }

            await cleanupQueue.add(
              'retry-delivery-search',
              { orderId: order._id },
              { delay: 120000, removeOnComplete: true } 
            );
          } else {
            order.status = 'cancelled_no_driver';
            order.cancelledAt = Date.now();
            order.history.push({
              status: 'cancelled_no_driver',
              comment: 'Annulation automatique : Aucun livreur disponible après 3 tentatives de dispatch.',
              timestamp: Date.now()
            });
            await order.save();

            logger.warn(`[DELIVERY FAIL] Echec définitif après 3 tentatives pour la commande ${order._id}. Commande annulée.`);

            notificationService.sendNotification(
              order.seller._id,
              'Commande annulée',
              `La commande #${order._id.toString().slice(-6)} a été annulée car aucun livreur n'a pu être trouvé à proximité après 3 tentatives.`,
              'ORDER_CANCELLED',
              { orderId: order._id.toString() }
            ).catch(() => {});

            notificationService.sendNotification(
              order.customer._id,
              'Commande annulée',
              `Votre commande chez ${order.seller.name} a été annulée car aucun livreur n'est actuellement disponible dans votre zone.`,
              'ORDER_CANCELLED',
              { orderId: order._id.toString() }
            ).catch(() => {});

            if (io) {
              io.to(order.seller._id.toString()).emit('order_updated', order);
              io.to(order.customer._id.toString()).emit('order_updated', order);
            }
          }
        }
      } catch (orderRetryError) {
        logger.error(`[DELIVERY RETRY ERROR] Erreur lors de la gestion du retry pour le ride ${rideId} : ${orderRetryError.message}`);
      }
    }
  }
};

const retryDeliverySearch = rideDeliveryRetryService.retryDeliverySearch;

module.exports = {
  cleanupQueue,
  dispatchToNearbyDrivers,
  expandSearchRadius,
  cancelSearchTimeout,
  retryDeliverySearch
};
