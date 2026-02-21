// src/services/rideService.js
// SERVICE COURSE - Iron Dome avec Calcul des Gains Automatique
// CSCSM Level: Bank Grade

const mongoose = require('mongoose');
const axios = require('axios');
const { Queue } = require('bullmq');
const Ride = require('../models/Ride');
const User = require('../models/User'); // 🚀 NOUVEAU : Import pour les stats
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
    throw new Error('Itinéraire introuvable.');
  } catch (error) {
    logger.warn(`[ROUTING] Fallback activé: ${error.message}`);
    const directDist = calculateHaversineDistance(originCoords, destCoords);
    return parseFloat((directDist * 1.3).toFixed(2));
  }
};

const createRideRequest = async (riderId, rideData, redisClient) => {
  const lockKey = `lock:ride_req:${riderId}`;
  const isLocked = await redisClient.set(lockKey, '1', 'NX', 'EX', 10);
  
  if (!isLocked) {
    throw new AppError('Traitement en cours, veuillez patienter.', 429);
  }

  try {
    const existingRide = await Ride.findOne({
      rider: riderId,
      status: { $in: ['searching', 'negotiating', 'accepted', 'ongoing'] }
    });
    
    if (existingRide) {
      if (['searching', 'negotiating'].includes(existingRide.status)) {
        logger.info(`[RIDE] Nettoyage course fantôme ${existingRide._id}`);
        existingRide.status = 'cancelled';
        existingRide.cancellationReason = 'Annulation automatique par nouvelle requête';
        await existingRide.save();
      } else {
        throw new AppError('Vous avez déjà une course active en cours.', 409);
      }
    }

    const { origin, destination, forfait } = rideData; 
    const distance = await getRouteDistance(origin.coordinates, destination.coordinates);

    if (distance < 0.1) throw new AppError('Distance invalide.', 400);

    const priceOptions = await pricingService.generatePriceOptions(distance);

    const ride = await Ride.create({
      rider: riderId,
      origin,
      destination,
      distance,
      forfait: forfait || 'STANDARD',
      priceOptions,
      status: 'searching',
      rejectedDrivers: []
    });

    await cleanupQueue.add(
      'check-search-timeout',
      { rideId: ride._id },
      { delay: 90000, removeOnComplete: true }
    );

    const nearbyDriverIds = await redisClient.georadius(
      'active_drivers', 
      origin.coordinates[0], 
      origin.coordinates[1], 
      5, 'km'
    );

    const drivers = await userRepository.findActiveDriversByIds(nearbyDriverIds, []);

    drivers.forEach(driver => {
      sendPushNotification(
        driver._id,
        'Nouvelle demande',
        `Course de ${distance} km disponible.`,
        { rideId: ride._id.toString(), type: 'NEW_RIDE_REQUEST' }
      ).catch(err => logger.error(`[PUSH ERROR] ${err.message}`));
    });

    return { ride, drivers };
  } finally {
    await redisClient.del(lockKey);
  }
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

  if (!ride) throw new AppError('Course indisponible.', 409);

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
  if (!isValidOption) throw new AppError('Montant non autorisé.', 400);

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
  const ride = await Ride.findOneAndUpdate(
    { _id: rideId, driver: driverId, status: 'accepted' }, 
    { $set: { status: 'ongoing', startedAt: new Date() } }, 
    { new: true }
  );
  if (!ride) throw new AppError('Validation impossible.', 400);
  return ride;
};

// 🚀 VAGUE 2 : LOGIQUE DE CALCUL DES GAINS AUTOMATIQUE
const completeRideSession = async (driverId, rideId) => {
  const session = await mongoose.startSession();
  let result;
  try {
    session.startTransaction();
    
    const ride = await Ride.findOneAndUpdate(
      { _id: rideId, driver: driverId, status: 'ongoing' }, 
      { $set: { status: 'completed', completedAt: new Date() } }, 
      { new: true, session }
    );
    
    if (!ride) throw new AppError('Validation impossible.', 400);
    
    // 1. Libérer le chauffeur pour de nouvelles courses
    await userRepository.updateDriverAvailability(driverId, true, session);
    
    // 2. Mettre à jour les statistiques du chauffeur (Compteur + Argent)
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
    ride.cancellationReason = 'Temps de recherche expiré (1m30)';
    await ride.save();
    io.to(ride.rider.toString()).emit('search_timeout', {
      message: "Aucun chauffeur n'est disponible pour le moment."
    });
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
  lockRideForNegotiation,
  submitPriceProposal,
  finalizeProposal,
  startRideSession,
  completeRideSession,
  getRouteDistance,
  cancelSearchTimeout,
  releaseStuckNegotiations
};