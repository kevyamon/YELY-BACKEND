// src/services/ride/rideExecutionService.js
// SERVICE METIER - Execution active des sessions de course et livraisons
// STANDARD: Industriel / Bank Grade

const mongoose = require('mongoose');
const Ride = require('../../models/Ride');
const User = require('../../models/User');
const userRepository = require('../../repositories/userRepository');
const poiController = require('../../controllers/poiController'); 
const notificationService = require('../notificationService'); 
const AppError = require('../../utils/AppError');
const logger = require('../../config/logger');

// Modules auxiliaires modularisés
const { calculateHaversineDistance } = require('./rideHelpers');
const rideGeofenceService = require('./rideGeofenceService');
const rideHistoryService = require('./rideHistoryService');
const rideCompletionService = require('./rideCompletionService');

const markRideAsArrived = async (driverId, rideId) => {
  const ride = await Ride.findOne({ _id: rideId, driver: driverId });
  
  if (!ride) {
    throw new AppError('Course introuvable ou non assignee a ce chauffeur.', 404);
  }

  if (ride.status === 'arrived') {
    logger.info(`[IDEMPOTENCE] Course ${rideId} deja marquee comme arrivee.`);
    return ride;
  }

  if (ride.status !== 'accepted') {
    logger.warn(`[SECURITY] Tentative de passage au statut arrive invalide. Status: ${ride.status}`);
    throw new AppError("Action impossible a ce stade de la course.", 403);
  }

  ride.status = 'arrived';
  ride.arrivedAt = new Date();
  await ride.save();
  
  return ride;
};

const startRideSession = async (driverId, rideId, io) => {
  const ride = await Ride.findOne({ _id: rideId, driver: driverId });
  
  if (!ride) {
    throw new AppError('Course introuvable ou non assignee a ce chauffeur.', 404);
  }
  
  if (ride.status === 'in_progress') {
    logger.info(`[IDEMPOTENCE] Course ${rideId} deja demarree. Renvoi silencieux du succes.`);
    return ride;
  }

  if (!['accepted', 'arrived'].includes(ride.status)) {
    logger.warn(`[SECURITY] Tentative de demarrage de course invalide. Status: ${ride.status}`);
    throw new AppError("Action impossible a ce stade de la course.", 403);
  }

  const driver = await User.findById(driverId);
  if (driver?.currentLocation?.coordinates) {
    const dist = calculateHaversineDistance(
      driver.currentLocation.coordinates,
      ride.origin.coordinates
    );
    if (dist > 0.15) {
      logger.warn(`[SECURITY] Fraude evitee (Start Ride). Driver: ${driverId}, Dist: ${dist}km`);
      throw new AppError(`Securite : Vous etes trop loin du point de rencontre (${(dist * 1000).toFixed(0)}m). Tolerance : 150m.`, 403);
    }
  }

  ride.status = 'in_progress';
  ride.startedAt = new Date();
  await ride.save();

  // --- COUPLAGE D'ÉTAT MARKETPLACE (PICKED UP) ---
  if (ride.type === 'DELIVERY' && ride.orderId) {
    const Order = require('../../models/Order');
    const order = await Order.findById(ride.orderId).populate('customer seller driver');
    if (order) {
      order.status = 'picked_up';
      order.pickedUpAt = Date.now();
      order.history.push({ status: 'picked_up', comment: 'Colis récupéré par le livreur', timestamp: Date.now() });
      await order.save();
      
      if (io) {
        io.to(order.customer._id.toString()).emit('order_updated', order);
        io.to(order.seller._id.toString()).emit('order_updated', order);
      }
      
      notificationService.sendNotification(
        order.customer._id,
        "Colis récupéré ! 🚴",
        `Votre livreur ${driver.name || 'Yély'} a récupéré votre commande. Il est en route !`,
        "ORDER_UPDATE",
        { orderId: order._id.toString() }
      ).catch(() => {});
    }
  }
  
  return ride;
};

const completeRideSession = rideCompletionService.completeRideSession;

const collectPointAction = async (rideId, driverId, sellerId, io = null) => {
  const ride = await Ride.findOne({ _id: rideId, driver: driverId });
  if (!ride) throw new AppError('Course introuvable.', 404);

  if (ride.status !== 'accepted' && ride.status !== 'arrived') {
    throw new AppError('La course n\'est pas dans un état permettant la collecte.', 400);
  }

  const point = ride.collectionPoints.find(p => p.seller.toString() === sellerId.toString());
  if (!point) throw new AppError('Ce vendeur ne fait pas partie des points de collecte.', 400);

  if (point.isCollected) {
    throw new AppError('Ce point de collecte a déjà été validé.', 400);
  }

  point.isCollected = true;
  await ride.save();

  logger.info(`[DELIVERY COLLECT] Point de collecte ${sellerId} validé pour le Ride ${rideId}.`);

  const allCollected = ride.collectionPoints.every(p => p.isCollected);

  if (allCollected) {
    ride.status = 'in_progress';
    await ride.save();

    if (ride.orderId) {
      const Order = require('../../models/Order');
      const order = await Order.findById(ride.orderId).populate('customer seller driver');
      if (order) {
        order.status = 'picked_up';
        order.history.push({
          status: 'picked_up',
          comment: 'Tous les colis ont été récupérés par le livreur. En cours de livraison vers le client.',
          timestamp: Date.now()
        });
        await order.save();

        if (io) {
          io.to(order.customer._id.toString()).emit('order_updated', order);
          io.to(order.seller._id.toString()).emit('order_updated', order);
        }

        notificationService.sendNotification(
          order.customer._id,
          'Commande en cours de livraison',
          `Le livreur a récupéré tous vos articles et est en route vers votre adresse.`,
          'ORDER_UPDATE',
          { orderId: order._id.toString() }
        ).catch(() => {});
      }
    }

    if (io) {
      io.to(ride.rider.toString()).emit('ride_status_update', { rideId, status: 'in_progress', ride });
      io.to(driverId.toString()).emit('ride_status_update', { rideId, status: 'in_progress', ride });
    }

    logger.info(`[DELIVERY IN_PROGRESS] Tous les colis collectés pour Ride ${rideId}. Statut course passée à in_progress.`);
  } else {
    if (io) {
      io.to(ride.rider.toString()).emit('ride_status_update', { rideId, status: ride.status, ride });
      io.to(driverId.toString()).emit('ride_status_update', { rideId, status: ride.status, ride });
    }
  }

  return { success: true, allCollected, ride };
};

module.exports = {
  // Re-exports pour retrocompatibilité
  checkRideProgressOnLocationUpdate: rideGeofenceService.checkRideProgressOnLocationUpdate,
  submitRideRating: rideHistoryService.submitRideRating,
  getRideHistory: rideHistoryService.getRideHistory,
  hideRideFromHistory: rideHistoryService.hideRideFromHistory,
  hideAllRidesFromHistory: rideHistoryService.hideAllRidesFromHistory,

  // Core execution functions
  markRideAsArrived,
  startRideSession,
  completeRideSession,
  collectPointAction
};