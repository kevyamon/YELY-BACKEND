// src/services/ride/rideExecutionService.js
// SERVICE METIER - Execution de la course, Geofencing, Notation et Liberation POI
// CSCSM Level: Bank Grade

const mongoose = require('mongoose');
const Ride = require('../../models/Ride');
const User = require('../../models/User');
const userRepository = require('../../repositories/userRepository');
const poiController = require('../../controllers/poiController'); 
const notificationService = require('../notificationService'); 
const AppError = require('../../utils/AppError');
const logger = require('../../config/logger');

const calculateHaversineDistance = (coords1, coords2) => {
  const [lng1, lat1] = coords1;
  const [lng2, lat2] = coords2;
  const R = 6371; 
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return parseFloat((R * c).toFixed(3));
};

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

const completeRideSession = async (driverId, rideId, io) => {
  const session = await mongoose.startSession();
  let result;
  
  try {
    await session.withTransaction(async () => {
      const ride = await Ride.findOne({ _id: rideId, driver: driverId }).session(session);
      
      if (!ride) {
        throw new AppError('Course introuvable ou non assignee a ce chauffeur.', 404);
      }
      
      if (ride.status === 'completed') {
        logger.info(`[IDEMPOTENCE] Course ${rideId} deja cloturee. Renvoi silencieux du succes.`);
        result = ride;
        return; 
      }

      if (ride.status !== 'in_progress') {
        logger.warn(`[SECURITY] Tentative de cloture de course invalide. Status: ${ride.status}`);
        throw new AppError("Action impossible a ce stade de la course.", 403);
      }

      const driver = await User.findById(driverId).session(session);
      if (driver?.currentLocation?.coordinates) {
        const dist = calculateHaversineDistance(
          driver.currentLocation.coordinates,
          ride.destination.coordinates
        );
        if (dist > 0.05) {
          logger.warn(`[SECURITY] Fraude evitee (Complete Ride). Driver: ${driverId}, Dist: ${dist}km`);
          throw new AppError(`Securite : Vous etes trop loin de la destination (${(dist * 1000).toFixed(0)}m). Tolerance : 50m.`, 403);
        }
      }

      ride.status = 'completed';
      ride.completedAt = new Date();
      await ride.save({ session });
      
      await userRepository.updateDriverAvailability(driverId, true, session);
      
      await User.findByIdAndUpdate(driverId, {
        $inc: { 
          totalRides: 1, 
          totalEarnings: ride.price || 0
        }
      }, { session });

      // --- COUPLAGE D'ÉTAT MARKETPLACE (DELIVERED) & RECONCILIATION ---
      if (ride.type === 'DELIVERY' && ride.orderId) {
        const Order = require('../../models/Order');
        const Ledger = require('../../models/Ledger');
        
        const order = await Order.findById(ride.orderId).session(session);
        if (order) {
          order.status = 'delivered';
          order.deliveredAt = Date.now();
          order.driver = ride.driver;
          order.history.push({ status: 'delivered', comment: 'Commande livrée avec succès', timestamp: Date.now() });
          await order.save({ session });

          // Créer l'ardoise financière (Ledger) pour la réconciliation du cash des produits collecté par le livreur
          await Ledger.create([{
            driver: ride.driver,
            seller: order.seller,
            order: order._id,
            amount: order.itemsPrice,
            status: 'pending',
            note: `Création automatique suite à la livraison réussie du Ride ${ride._id}`
          }], { session });

          // Incrémenter la dette cash du livreur et appliquer la sécurité anti-dépassement
          const driverDoc = await User.findById(ride.driver).session(session);
          if (driverDoc) {
            driverDoc.ledger = driverDoc.ledger || {};
            driverDoc.ledger.currentCashDebt = (driverDoc.ledger.currentCashDebt || 0) + order.itemsPrice;
            
            if (driverDoc.ledger.currentCashDebt >= (driverDoc.ledger.maxCashDebt || 100000)) {
              driverDoc.ledger.isBlocked = true;
              logger.warn(`[SECURITY] Livreur ${driverDoc.email} bloqué automatiquement suite à dépassement de la dette maximale.`);
            }
            await driverDoc.save({ session });
          }
        }
      }
      
      result = ride;
    });
  } finally {
    await session.endSession();
  }

  if (result && io) {
    if (result.origin?.address) {
      await poiController.releasePendingPOI(result.origin.address, io);
    }
    if (result.destination?.address) {
      await poiController.releasePendingPOI(result.destination.address, io);
    }

    // --- SOCKETS ET PUSH NOTIFICATIONS MARKETPLACE APRES LIVRAISON ---
    if (result.type === 'DELIVERY' && result.orderId) {
      try {
        const Order = require('../../models/Order');
        const order = await Order.findById(result.orderId).populate('customer seller driver');
        if (order) {
          io.to(order.customer._id.toString()).emit('order_updated', order);
          io.to(order.seller._id.toString()).emit('order_updated', order);
          
          notificationService.sendNotification(
            order.customer._id, 
            'Livrée ! 🎉', 
            'Votre commande a été livrée. Merci de votre confiance !', 
            'ORDER_COMPLETE', 
            { orderId: order._id.toString() }
          ).catch(() => {});

          notificationService.sendNotification(
            order.seller._id, 
            'Livraison effectuée ! 💰', 
            `Le livreur ${order.driver?.name || 'Yély'} vous doit ${order.itemsPrice} FCFA pour la commande #${order._id.toString().slice(-6)}.`, 
            'ORDER_UPDATE', 
            { orderId: order._id.toString() }
          ).catch(() => {});
        }
      } catch (completeNotifyError) {
        logger.error(`[NOTIFY ERROR] Échec de l'envoi de notification de livraison : ${completeNotifyError.message}`);
      }
    }
  }

  return result;
};

const submitRideRating = async (rideId, rating, comment) => {
  const session = await mongoose.startSession();
  let result;

  try {
    await session.withTransaction(async () => {
      const ride = await Ride.findById(rideId).session(session);
      if (!ride) throw new AppError('Course introuvable.', 404);

      if (ride.status !== 'completed') {
        throw new AppError('La course doit etre terminee pour etre notee.', 400);
      }

      if (ride.ratingGiven) {
        throw new AppError('Cette course a deja ete notee.', 400);
      }

      if (ride.driver) {
        const driver = await User.findById(ride.driver).session(session);
        if (driver) {
          const currentRating = driver.rating || 5.0;
          const currentCount = driver.ratingCount || 0;
          
          const newCount = currentCount + 1;
          const newRating = ((currentRating * currentCount) + rating) / newCount;

          driver.rating = parseFloat(newRating.toFixed(2));
          driver.ratingCount = newCount;
          await driver.save({ session });
        }
      }

      ride.ratingGiven = rating;
      await ride.save({ session });
      result = ride;
    });
  } finally {
    await session.endSession();
  }
  return result;
};

const checkRideProgressOnLocationUpdate = async (driverId, coordinates, io) => {
  try {
    const ride = await Ride.findOne({
      driver: driverId,
      status: { $in: ['accepted', 'in_progress'] }
    });

    if (!ride) return;

    if (ride.status === 'accepted') {
      const distToPickup = calculateHaversineDistance(coordinates, ride.origin.coordinates);
      
      if (distToPickup <= 0.015) {
        ride.status = 'arrived';
        ride.arrivedAt = new Date();
        await ride.save();

        io.to(ride.rider.toString()).emit('ride_arrived', { rideId: ride._id, arrivedAt: ride.arrivedAt });
        io.to(driverId.toString()).emit('ride_arrived', { rideId: ride._id, arrivedAt: ride.arrivedAt });
        
        notificationService.sendNotification(
          ride.rider, "Chauffeur sur place", "Votre chauffeur est arrive au point de rendez-vous.", "DRIVER_ARRIVED", { rideId: ride._id.toString() }
        ).catch(() => {});

        logger.info(`[GEOFENCING] Driver ${driverId} arrive chez le client (15m). Statut MAJ vers 'arrived'`);
      }
    }

    if (ride.status === 'in_progress') {
      const distToDropoff = calculateHaversineDistance(coordinates, ride.destination.coordinates);
      
      if (distToDropoff <= 0.02) {
        io.to(driverId.toString()).emit('prompt_arrival_confirm', { rideId: ride._id });
        logger.info(`[GEOFENCING] Course ${ride._id} a 20m de la destination. Modale declenchee.`);
      }
    }
  } catch (error) {
    logger.error(`[GEOFENCING ERROR] Echec de la verification de proximite: ${error.message}`);
  }
};

const getRideHistory = async (user, page = 1, limit = 20) => {
  const skip = (page - 1) * limit;
  const filter = {};
  
  if (user.role === 'driver') {
    filter.driver = user._id;
    filter.hiddenForDriver = { $ne: true };
  } else {
    filter.rider = user._id;
    filter.hiddenForRider = { $ne: true };
  }

  filter.status = { $nin: ['pending', 'searching'] };

  const rides = await Ride.find(filter)
    .populate('rider', 'name profilePicture')
    .populate('driver', 'name profilePicture vehicle')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  const total = await Ride.countDocuments(filter);

  return {
    rides,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    }
  };
};

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

const hideRideFromHistory = async (user, rideId) => {
  const ride = await Ride.findById(rideId);
  if (!ride) throw new AppError("Course introuvable.", 404);

  if (user.role === 'driver' && ride.driver && ride.driver.toString() === user._id.toString()) {
    ride.hiddenForDriver = true;
  } else if (ride.rider && ride.rider.toString() === user._id.toString()) {
    ride.hiddenForRider = true;
  } else {
    throw new AppError("Non autorise a masquer cette course.", 403);
  }

  await ride.save();
  return true;
};

const hideAllRidesFromHistory = async (user) => {
  if (user.role === 'driver') {
    await Ride.updateMany(
      { driver: user._id, status: { $in: ['completed', 'cancelled'] } },
      { $set: { hiddenForDriver: true } }
    );
  } else {
    await Ride.updateMany(
      { rider: user._id, status: { $in: ['completed', 'cancelled'] } },
      { $set: { hiddenForRider: true } }
    );
  }
  return true;
};

module.exports = {
  markRideAsArrived,
  startRideSession,
  completeRideSession,
  collectPointAction,
  submitRideRating,
  checkRideProgressOnLocationUpdate,
  getRideHistory,
  hideRideFromHistory,
  hideAllRidesFromHistory
};