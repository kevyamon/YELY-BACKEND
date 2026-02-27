const mongoose = require('mongoose');
const axios = require('axios');
const { Queue } = require('bullmq');
const Ride = require('../models/Ride');
const User = require('../models/User');
const userRepository = require('../repositories/userRepository');
const pricingService = require('./pricingService');
const AppError = require('../utils/AppError');
const logger = require('../config/logger');
const { env } = require('../config/env');
const { sendPushNotification } = require('./notificationService');

const cleanupQueue = new Queue('ride-cleanup', { 
  connection: { url: env.REDIS_URL } 
});

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
  return parseFloat((R * c).toFixed(2));
};

const getRouteDistance = async (originCoords, destCoords) => {
  try {
    const token = env.LOCATION_IQ_TOKEN;
    if (!token) throw new Error("Token LocationIQ manquant.");

    const url = `https://us1.locationiq.com/v1/directions/driving/${originCoords[0]},${originCoords[1]};${destCoords[0]},${destCoords[1]}?key=${token}&overview=false`;
    const response = await axios.get(url, { timeout: 3000 });

    if (response.data?.routes?.length > 0) {
      const distanceMeters = response.data.routes[0].distance;
      return parseFloat((distanceMeters / 1000).toFixed(2));
    }
    throw new Error('Itineraire introuvable.');
  } catch (error) {
    logger.warn(`[ROUTING] Fallback active: ${error.message}`);
    const directDist = calculateHaversineDistance(originCoords, destCoords);
    return parseFloat((directDist * 1.3).toFixed(2));
  }
};

const createRideRequest = async (riderId, rideData, redisClient) => {
  const lockKey = `lock:ride_req:${riderId}`;
  let lockAcquired = false;
  
  try {
    const isLocked = await redisClient.set(lockKey, '1', 'NX', 'EX', 10);
    if (!isLocked) {
      throw new AppError('Traitement en cours, veuillez patienter.', 429);
    }
    lockAcquired = true;

    const existingRide = await Ride.findOne({
      rider: riderId,
      status: { $in: ['searching', 'negotiating', 'accepted', 'ongoing'] }
    });
    
    if (existingRide) {
      if (['accepted', 'ongoing'].includes(existingRide.status)) {
        throw new AppError('Vous avez deja une course active. Veuillez l\'annuler ou la terminer d\'abord.', 409);
      } else {
        logger.info(`[DISPATCH] Requete interceptee : Renvoi de la course en cours (Idempotence) pour le passager ${riderId}`);
        return { ride: existingRide, drivers: [] }; 
      }
    }

    const { origin, destination, forfait } = rideData; 
    
    const originCoords = [parseFloat(origin.coordinates[0]), parseFloat(origin.coordinates[1])];
    const destCoords = [parseFloat(destination.coordinates[0]), parseFloat(destination.coordinates[1])];
    
    logger.info(`[DISPATCH] Nouvelle demande. Recherche autour de Lng: ${originCoords[0]}, Lat: ${originCoords[1]}`);

    const distance = await getRouteDistance(originCoords, destCoords);

    if (distance < 0.1) throw new AppError('Distance invalide.', 400);

    const pricingResult = await pricingService.generatePriceOptions(originCoords, destCoords, distance);

    const ride = await Ride.create({
      rider: riderId,
      origin: { ...origin, coordinates: originCoords },
      destination: { ...destination, coordinates: destCoords },
      distance,
      forfait: forfait || 'STANDARD',
      priceOptions: pricingResult.options, 
      status: 'searching',
      rejectedDrivers: []
    });

    await cleanupQueue.add(
      'check-search-timeout',
      { rideId: ride._id },
      { delay: 90000, removeOnComplete: true }
    );

    const maxDistanceInMeters = 5000;
    const drivers = await userRepository.findAvailableDriversNear(
      originCoords,
      maxDistanceInMeters,
      null, 
      []
    );
    
    logger.info(`[DISPATCH] ${drivers.length} chauffeurs trouves dans un rayon de ${maxDistanceInMeters}m.`);

    drivers.forEach(driver => {
      sendPushNotification(
        driver._id,
        'Nouvelle demande de course',
        `Course de ${distance} km disponible a proximite.`,
        { rideId: ride._id.toString(), type: 'NEW_RIDE_REQUEST' }
      ).catch(err => logger.error(`[PUSH ERROR] ${err.message}`));
    });

    return { ride, drivers };
  } finally {
    if (lockAcquired) {
      await redisClient.del(lockKey);
    }
  }
};

const cancelRideAction = async (rideId, userId, userRole, reason) => {
  const query = { _id: rideId };
  if (userRole === 'rider') query.rider = userId;
  else if (userRole === 'driver') query.driver = userId;

  const ride = await Ride.findOne(query);
  if (!ride) throw new AppError('Course introuvable ou acces refuse.', 404);
  
  if (['completed', 'cancelled'].includes(ride.status)) {
    throw new AppError('Course deja terminee ou annulee.', 400);
  }

  ride.status = 'cancelled';
  ride.cancellationReason = reason || 'Annulee manuellement';
  await ride.save();

  if (ride.driver) {
    await userRepository.updateDriverAvailability(ride.driver, true);
  }

  return ride;
};

const emergencyCancelUserRides = async (userId) => {
  const activeRides = await Ride.find({
    rider: userId,
    status: { $in: ['searching', 'negotiating', 'accepted', 'ongoing'] }
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
    driversFreed: driverIdsToFree 
  };
};

const lockRideForNegotiation = async (rideId, driverId) => {
  const ride = await Ride.findOneAndUpdate(
    { _id: rideId, status: 'searching' },
    { 
      $set: { 
        status: 'negotiating', 
        driver: driverId, 
        negotiationStartedAt: new Date() 
      } 
    },
    { new: true }
  );

  if (!ride) throw new AppError('Course indisponible ou deja prise.', 409);

  await cleanupQueue.add(
    'check-stuck-negotiation', 
    { rideId: ride._id }, 
    { delay: 60000, removeOnComplete: true }
  );

  return ride;
};

const submitPriceProposal = async (rideId, driverId, selectedAmount) => {
  const ride = await Ride.findOne({ _id: rideId, driver: driverId, status: 'negotiating' });
  if (!ride) throw new AppError('Session invalide.', 404);

  const isValidOption = ride.priceOptions.some(opt => opt.amount === selectedAmount);
  if (!isValidOption) throw new AppError('Montant non autorise.', 400);

  ride.proposedPrice = selectedAmount;
  await ride.save();
  return ride;
};

const finalizeProposal = async (rideId, riderId, decision) => {
  const session = await mongoose.startSession();
  let result;

  try {
    session.startTransaction();
    const ride = await Ride.findOne({ _id: rideId, rider: riderId, status: 'negotiating' }).session(session);
    if (!ride) throw new AppError('Session invalide.', 404);

    if (decision === 'ACCEPTED') {
      ride.status = 'accepted';
      ride.price = ride.proposedPrice;
      ride.acceptedAt = new Date();
      await ride.save({ session });
      
      await userRepository.updateDriverAvailability(ride.driver, false, session);
      
      result = { status: 'ACCEPTED', ride };
    } else {
      const rejectedDriverId = ride.driver;
      ride.status = 'searching';
      ride.driver = null;
      ride.proposedPrice = null;
      ride.negotiationStartedAt = null;
      ride.rejectedDrivers.push(rejectedDriverId);
      
      await ride.save({ session });
      result = { status: 'SEARCHING_AGAIN', ride, rejectedDriverId };
    }
    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
  return result;
};

const startRideSession = async (driverId, rideId) => {
  const ride = await Ride.findOne({ _id: rideId, driver: driverId });
  
  if (!ride) {
    throw new AppError('Course introuvable ou non assignee a ce chauffeur.', 404);
  }
  
  if (ride.status === 'ongoing') {
    logger.info(`[IDEMPOTENCE] Course ${rideId} deja demarree. Renvoi silencieux du succes.`);
    return ride;
  }

  if (ride.status !== 'accepted') {
    logger.warn(`[SECURITY] Tentative de demarrage de course invalide. Driver: ${driverId}, Ride: ${rideId}, Status: ${ride.status}`);
    throw new AppError("Action impossible a ce stade de la course.", 403);
  }

  ride.status = 'ongoing';
  ride.startedAt = new Date();
  await ride.save();
  
  return ride;
};

const completeRideSession = async (driverId, rideId) => {
  const session = await mongoose.startSession();
  let result;
  
  try {
    session.startTransaction();
    
    const ride = await Ride.findOne({ _id: rideId, driver: driverId }).session(session);
    
    if (!ride) {
      throw new AppError('Course introuvable ou non assignee a ce chauffeur.', 404);
    }
    
    if (ride.status === 'completed') {
      logger.info(`[IDEMPOTENCE] Course ${rideId} deja cloturee. Renvoi silencieux du succes.`);
      await session.commitTransaction();
      return ride;
    }

    if (ride.status !== 'ongoing') {
      logger.warn(`[SECURITY] Tentative de cloture de course invalide. Driver: ${driverId}, Ride: ${rideId}, Status: ${ride.status}`);
      throw new AppError("Action impossible a ce stade de la course.", 403);
    }

    ride.status = 'completed';
    ride.completedAt = new Date();
    await ride.save({ session });
    
    await userRepository.updateDriverAvailability(driverId, true, session);
    
    await User.findByIdAndUpdate(driverId, {
      $inc: { 
        totalRides: 1, 
        totalEarnings: ride.price 
      }
    }, { session });
    
    result = ride;
    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
  return result;
};

const cancelSearchTimeout = async (io, rideId) => {
  const ride = await Ride.findOne({ _id: rideId, status: 'searching' });
  if (ride) {
    ride.status = 'cancelled';
    ride.cancellationReason = 'Temps de recherche expire (1m30)';
    await ride.save();
    
    io.to(ride.rider.toString()).emit('search_timeout', {
      message: "Aucun chauffeur n'est disponible pour le moment."
    });
    
    io.to('drivers').emit('ride_taken_by_other', { rideId });
  }
};

const releaseStuckNegotiations = async (io, rideId) => {
  const ride = await Ride.findOne({ _id: rideId, status: 'negotiating' });
  if (ride) {
    const rejectedDriverId = ride.driver;
    ride.status = 'searching';
    ride.driver = null;
    ride.proposedPrice = null;
    ride.negotiationStartedAt = null;
    ride.rejectedDrivers.push(rejectedDriverId);
    await ride.save();
    io.to(rejectedDriverId.toString()).emit('ride_taken_by_other', { rideId });
  }
};

module.exports = {
  createRideRequest,
  cancelRideAction,
  emergencyCancelUserRides,
  lockRideForNegotiation,
  submitPriceProposal,
  finalizeProposal,
  startRideSession,
  completeRideSession,
  getRouteDistance,
  cancelSearchTimeout,
  releaseStuckNegotiations
};