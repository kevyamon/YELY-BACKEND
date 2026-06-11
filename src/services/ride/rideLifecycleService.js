// src/services/ride/rideLifecycleService.js
// SERVICE METIER - Cycle de vie, creation et annulation des courses
// STANDARD: Industriel / Bank Grade

const mongoose = require('mongoose');
const Ride = require('../../models/Ride');
const User = require('../../models/User'); 
const userRepository = require('../../repositories/userRepository');
const pricingService = require('../pricingService');
const notificationService = require('../notificationService'); 
const AppError = require('../../utils/AppError');
const logger = require('../../config/logger');

// Modules modularisés
const rideHelpers = require('./rideHelpers');
const rideDispatchService = require('./rideDispatchService');
const rideNegotiationService = require('./rideNegotiationService');

const createRideRequest = async (riderId, rideData, redisClient) => {
  const lockKey = `lock:ride_req:${riderId}`;
  let lockAcquired = false;
  
  try {
    const isLocked = await redisClient.set(lockKey, '1', 'NX', 'EX', 10);
    if (!isLocked) {
      throw new AppError('Traitement en cours, veuillez patienter.', 429);
    }
    lockAcquired = true;
 
    const isDelivery = rideData?.type === 'DELIVERY';
    const existingRide = isDelivery
      ? null
      : await Ride.findOne({
          rider: riderId,
          type: 'RIDE',
          status: { $in: ['searching', 'negotiating', 'accepted', 'arrived', 'in_progress'] }
        });
    
    if (existingRide) {
      if (['accepted', 'arrived', 'in_progress'].includes(existingRide.status)) {
        throw new AppError('Vous avez deja une course active. Veuillez l\'annuler ou la terminer d\'abord.', 409);
      } else {
        logger.info(`[DISPATCH] Requete interceptee : Renvoi de la course en cours (Idempotence) pour le passager ${riderId}`);
        return { ride: existingRide, drivers: [] }; 
      }
    }
 
    const { origin, destination, forfait, passengersCount, type, orderId } = rideData; 
    const count = passengersCount || 1;
 
    const originCoords = [parseFloat(origin.coordinates[0]), parseFloat(origin.coordinates[1])];
    const destCoords = [parseFloat(destination.coordinates[0]), parseFloat(destination.coordinates[1])];
    
    const enrichedOriginAddress = await rideHelpers.enrichAddressWithPOI(origin.address, originCoords, redisClient);
    const enrichedDestAddress = await rideHelpers.enrichAddressWithPOI(destination.address, destCoords, redisClient);
    
    logger.info(`[DISPATCH] Nouvelle demande. Depart: ${enrichedOriginAddress}`);
 
    const distance = await rideHelpers.getRouteDistance(originCoords, destCoords);
    if (distance < 0.1) throw new AppError('Distance invalide.', 400);
 
    const pricingResult = type === 'DELIVERY'
      ? null
      : await pricingService.generatePriceOptions(originCoords, destCoords, distance, count, false);
    
    const initialRadius = 1000;
 
    const ride = await Ride.create({
      rider: riderId,
      origin: { ...origin, address: enrichedOriginAddress, coordinates: originCoords },
      destination: { ...destination, address: enrichedDestAddress, coordinates: destCoords },
      distance,
      forfait: forfait || 'STANDARD',
      passengersCount: count,
      priceOptions: type === 'DELIVERY'
        ? [{ label: 'STANDARD', amount: rideData.deliveryPrice || 0, description: 'Tarif de livraison fixe' }]
        : pricingResult.options, 
      status: 'searching',
      rejectedDrivers: [],
      notifiedDrivers: [],
      currentSearchRadius: initialRadius,
      type: type || 'RIDE',
      orderId: orderId || null,
      collectionPoints: rideData.collectionPoints || []
    });

    const drivers = await rideDispatchService.dispatchToNearbyDrivers(ride, initialRadius);

    await rideDispatchService.cleanupQueue.add(
      'expand-search',
      { rideId: ride._id },
      { delay: 30000, removeOnComplete: true }
    );

    return { ride, drivers };
  } finally {
    if (lockAcquired) {
      await redisClient.del(lockKey);
    }
  }
};

const cancelRideAction = async (rideId, userId, userRole, reason, io = null) => {
  const query = { _id: rideId };
  if (userRole === 'rider') query.rider = userId;
  else if (userRole === 'driver') query.driver = userId;

  const ride = await Ride.findOne(query);
  if (!ride) throw new AppError('Course introuvable ou accès refusé.', 404);
  
  if (['completed', 'cancelled'].includes(ride.status)) {
    throw new AppError('Course déjà terminée ou annulée.', 400);
  }

  ride.status = 'cancelled';
  ride.cancellationReason = reason || 'Annulée manuellement';
  await ride.save();

  if (ride.driver) {
    await userRepository.updateDriverAvailability(ride.driver, true);
  }

  if (ride.type === 'DELIVERY' && ride.orderId) {
    const Order = require('../../models/Order');
    const order = await Order.findById(ride.orderId);
    
    if (order) {
      if (userRole === 'rider' || userRole === 'seller') {
        order.status = 'cancelled';
        order.cancelledAt = Date.now();
        order.history.push({ status: 'cancelled', comment: 'Annulée par le client (livraison annulée)', timestamp: Date.now() });
        await order.save();
        logger.info(`[MARKETPLACE CANCEL] Commande ${order._id} annulée suite à annulation de course par le client.`);
      } else if (userRole === 'driver') {
        order.status = 'searching'; 
        order.driver = null;
        order.deliveryRideId = null;
        order.deliveryRetryCount = 0;
        await order.save();
        
        try {
          const redisClient = require('../../config/redis');
          const uniqueSellersMap = new Map();
          
          uniqueSellersMap.set(order.seller._id.toString(), {
            seller: order.seller._id,
            address: order.seller.address || 'Point de retrait vendeur',
            coordinates: order.seller.currentLocation.coordinates,
            isCollected: false
          });

          for (const item of order.items) {
            if (item.product && item.product.seller) {
              const sId = item.product.seller._id.toString();
              if (!uniqueSellersMap.has(sId)) {
                const secondarySeller = await User.findById(item.product.seller._id || item.product.seller);
                if (secondarySeller) {
                  uniqueSellersMap.set(sId, {
                    seller: secondarySeller._id,
                    address: secondarySeller.address || 'Point de retrait vendeur secondaire',
                    coordinates: secondarySeller.currentLocation.coordinates,
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
              coordinates: order.seller.currentLocation.coordinates
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
          
          const { ride: newRide, drivers } = await createRideRequest(order.customer, deliveryData, redisClient);
          order.deliveryRideId = newRide._id;
          await order.save();
          
          logger.info(`[MARKETPLACE RE-DISPATCH] Recherche livreur relancée après désistement chauffeur. Nouveau Ride: ${newRide._id}`);

          if (drivers && drivers.length > 0 && io) {
            const customer = await User.findById(order.customer).select('name profilePicture');
            drivers.forEach(driver => {
              io.to(driver._id.toString()).emit('new_ride_request', {
                rideId: newRide._id,
                origin: newRide.origin,       
                destination: newRide.destination, 
                distance: newRide.distance,
                forfait: newRide.forfait,
                passengersCount: newRide.passengersCount,
                priceOptions: newRide.priceOptions,
                riderName: customer?.name || 'Client',
                riderProfilePicture: customer?.profilePicture,
                collectionPoints: newRide.collectionPoints,
                type: 'DELIVERY'
              });
            });
          }
        } catch (reDispatchError) {
          logger.error(`[MARKETPLACE RE-DISPATCH ERROR] Échec de la relance après désistement : ${reDispatchError.message}`);
        }
      }
    }
  }

  return ride;
};

const emergencyCancelUserRides = async (userId) => {
  const activeRides = await Ride.find({
    $or: [
      { rider: userId },
      { driver: userId }
    ],
    status: { $in: ['searching', 'negotiating', 'accepted', 'arrived', 'in_progress'] }
  });

  if (activeRides.length === 0) {
    return { count: 0, message: 'Aucune course bloquee trouvee.' };
  }

  const driverIdsToFree = [];
  const rideIdsToCancel = [];

  for (const ride of activeRides) {
    rideIdsToCancel.push(ride._id);
    if (ride.driver) {
      driverIdsToFree.push(ride.driver);
    }
  }

  await Ride.updateMany(
    { _id: { $in: rideIdsToCancel } },
    { 
      $set: { 
        status: 'cancelled', 
        cancellationReason: 'Annulation systeme (Nettoyage d\'urgence)' 
      } 
    }
  );

  for (const driverId of driverIdsToFree) {
    await userRepository.updateDriverAvailability(driverId, true);
  }

  return { 
    count: activeRides.length, 
    ridesCleared: rideIdsToCancel, 
    driversFreed: driverIdsToFree,
    cancelledRides: activeRides 
  };
};

const finalizeProposal = rideNegotiationService.finalizeProposal;

module.exports = {
  // Re-exports pour retrocompatibilité
  calculateHaversineDistance: rideHelpers.calculateHaversineDistance,
  enrichAddressWithPOI: rideHelpers.enrichAddressWithPOI,
  getRouteDistance: rideHelpers.getRouteDistance,
  dispatchToNearbyDrivers: rideDispatchService.dispatchToNearbyDrivers,
  expandSearchRadius: rideDispatchService.expandSearchRadius,
  cancelSearchTimeout: rideDispatchService.cancelSearchTimeout,
  retryDeliverySearch: rideDispatchService.retryDeliverySearch,
  lockRideForNegotiation: rideNegotiationService.lockRideForNegotiation,
  submitPriceProposal: rideNegotiationService.submitPriceProposal,
  releaseStuckNegotiations: rideNegotiationService.releaseStuckNegotiations,

  // Core functions
  createRideRequest,
  cancelRideAction,
  emergencyCancelUserRides,
  finalizeProposal
};