// src/services/ride/rideExecutionService.js
// SERVICE METIER - Execution de la course, Geofencing, Notation et Liberation POI
// CSCSM Level: Bank Grade

const mongoose = require('mongoose');
const Ride = require('../../models/Ride');
const User = require('../../models/User');
const userRepository = require('../../repositories/userRepository');
const poiController = require('../../controllers/poiController'); 
const notificationService = require('../notificationService'); // IMPORT AJOUTE
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

const startRideSession = async (driverId, rideId) => {
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
        
        // DECLENCHEUR PUSH AUTOMATIQUE (Geofencing) : Arrivee par localisation GPS
        notificationService.sendNotification(
          ride.rider, "Chauffeur sur place", "Votre chauffeur est arrive au point de rendez-vous.", "SYSTEM", { rideId: ride._id.toString() }
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

module.exports = {
  markRideAsArrived,
  startRideSession,
  completeRideSession,
  submitRideRating,
  checkRideProgressOnLocationUpdate,
  getRideHistory,
  hideRideFromHistory
};