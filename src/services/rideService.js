// src/services/rideService.js
// FLUX COURSE - Cartographie Réelle, Négociation & Anti-Spam (Version Redis & BullMQ)
// CSCSM Level: Bank Grade

const mongoose = require('mongoose');
const axios = require('axios');
const { Queue } = require('bullmq');
const Ride = require('../models/Ride');
const userRepository = require('../repositories/userRepository'); // ✅ Remplacement de User par userRepository
const pricingService = require('./pricingService');
const AppError = require('../utils/AppError');
const logger = require('../config/logger');
const { env } = require('../config/env');
const { sendPushNotification } = require('./notificationService');

// 1. Initialisation de la file d'attente Redis pour le nettoyage
const cleanupQueue = new Queue('ride-cleanup', { 
  connection: { url: env.REDIS_URL } 
});

// Géométrie (Haversine) - Sert de Fallback (Secours)
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

/**
 * 🗺️ CALCUL DISTANCE RÉELLE (LocationIQ)
 */
const getRouteDistance = async (originCoords, destCoords) => {
  try {
    const token = env.LOCATION_IQ_TOKEN;
    if (!token) throw new Error("Token LocationIQ introuvable dans les variables d'environnement.");

    const url = `https://us1.locationiq.com/v1/directions/driving/${originCoords[0]},${originCoords[1]};${destCoords[0]},${destCoords[1]}?key=${token}&overview=false`;
    const response = await axios.get(url, { timeout: 3000 });

    if (response.data && response.data.routes && response.data.routes.length > 0) {
      const distanceMeters = response.data.routes[0].distance;
      return parseFloat((distanceMeters / 1000).toFixed(2));
    }
    throw new Error('Aucun itinéraire routier trouvé par LocationIQ');

  } catch (error) {
    logger.warn(`[ROUTING FAIL] API LocationIQ HS ou erreur, passage au plan B (Haversine) : ${error.message}`);
    const directDist = calculateHaversineDistance(originCoords, destCoords);
    return parseFloat((directDist * 1.3).toFixed(2));
  }
};

/**
 * 1. CRÉER LA DEMANDE (Rider)
 */
const createRideRequest = async (riderId, rideData, redis) => {
  const existingRide = await Ride.findOne({
    rider: riderId,
    status: { $in: ['searching', 'negotiating', 'accepted', 'ongoing'] }
  });
  if (existingRide) throw new AppError('Vous avez déjà une course active.', 409);

  const { origin, destination } = rideData;
  const distance = await getRouteDistance(origin.coordinates, destination.coordinates);

  if (distance < 0.1) throw new AppError('Distance invalide (<100m).', 400);

  const priceOptions = await pricingService.generatePriceOptions(distance);

  const ride = await Ride.create({
    rider: riderId,
    origin,
    destination,
    distance,
    priceOptions,
    status: 'searching',
    rejectedDrivers: []
  });

  const nearbyDriverIds = await redis.georadius(
    'active_drivers', 
    origin.coordinates[0], 
    origin.coordinates[1], 
    5, 'km'
  );

  // 🚀 UTILISATION DU REPOSITORY : Couplage faible, code testable
  const drivers = await userRepository.findActiveDriversByIds(nearbyDriverIds, ride.rejectedDrivers);

  drivers.forEach(driver => {
    sendPushNotification(
      driver._id,
      '🚨 Nouvelle course à proximité !',
      `Une course de ${distance} km est disponible. Ouvrez vite l'application !`,
      { rideId: ride._id.toString(), type: 'NEW_RIDE_REQUEST' }
    ).catch(err => logger.error(`[PUSH ASYNC ERROR] ${err.message}`));
  });

  return { ride, drivers };
};

/**
 * 2. LOCKER LA COURSE (Driver)
 */
const lockRideForNegotiation = async (rideId, driverId) => {
  const ride = await Ride.findOneAndUpdate(
    { _id: rideId, status: 'searching' },
    { status: 'negotiating', driver: driverId, negotiationStartedAt: new Date() },
    { new: true }
  );

  if (!ride) throw new AppError('Course déjà prise par un autre chauffeur.', 409);

  await cleanupQueue.add(
    'check-stuck-negotiation', 
    { rideId: ride._id }, 
    { delay: 60000, removeOnComplete: true }
  );

  return ride;
};

/**
 * 3. PROPOSER PRIX (Driver)
 */
const submitPriceProposal = async (rideId, driverId, selectedAmount) => {
  const ride = await Ride.findOne({ _id: rideId, driver: driverId, status: 'negotiating' });
  if (!ride) throw new AppError('Course expirée ou invalide.', 404);

  const isValidOption = ride.priceOptions.some(opt => opt.amount === selectedAmount);
  if (!isValidOption) throw new AppError('Prix invalide (Tentative de fraude).', 400);

  ride.proposedPrice = selectedAmount;
  await ride.save();
  return ride;
};

/**
 * 4. FINALISER (Rider)
 */
const finalizeProposal = async (rideId, riderId, decision) => {
  const session = await mongoose.startSession();
  let result;

  await session.withTransaction(async () => {
    const ride = await Ride.findOne({ _id: rideId, rider: riderId, status: 'negotiating' }).session(session);
    if (!ride) throw new AppError('Demande invalide.', 404);

    if (decision === 'ACCEPTED') {
      ride.status = 'accepted';
      ride.price = ride.proposedPrice;
      ride.acceptedAt = new Date();
      await ride.save({ session });
      
      // 🚀 UTILISATION DU REPOSITORY POUR L'UPDATE
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
  });
  session.endSession();
  return result;
};

const startRideSession = async (driverId, rideId) => {
  const ride = await Ride.findOneAndUpdate(
    { _id: rideId, driver: driverId, status: 'accepted' }, 
    { status: 'ongoing', startedAt: new Date() }, 
    { new: true }
  );
  if (!ride) throw new AppError('Action impossible.', 400);
  return ride;
};

const completeRideSession = async (driverId, rideId) => {
  const session = await mongoose.startSession();
  let result;
  await session.withTransaction(async () => {
    const ride = await Ride.findOneAndUpdate(
      { _id: rideId, driver: driverId, status: 'ongoing' }, 
      { status: 'completed', completedAt: new Date() }, 
      { new: true, session }
    );
    if (!ride) throw new AppError('Action impossible.', 400);
    
    // 🚀 UTILISATION DU REPOSITORY POUR L'UPDATE
    await userRepository.updateDriverAvailability(driverId, true, session);
    
    result = ride;
  });
  session.endSession();
  return result;
};

const releaseStuckNegotiations = async (io, specificRideId = null) => {
  const query = specificRideId 
    ? { _id: specificRideId, status: 'negotiating' }
    : { status: 'negotiating', negotiationStartedAt: { $lt: new Date(Date.now() - 60000) } };

  const stuckRides = await Ride.find(query);

  for (const ride of stuckRides) {
    if (specificRideId && ride.negotiationStartedAt > new Date(Date.now() - 55000)) continue;

    const blockedDriverId = ride.driver;
    ride.status = 'searching';
    ride.driver = null;
    ride.proposedPrice = null;
    ride.negotiationStartedAt = null;
    if (blockedDriverId) ride.rejectedDrivers.push(blockedDriverId);
    await ride.save();

    if (io) {
      io.to(ride.rider.toString()).emit('negotiation_timeout', { message: "Délai dépassé." });
      if (blockedDriverId) {
        io.to(blockedDriverId.toString()).emit('negotiation_cancelled', { message: "Temps écoulé." });
      }
    }
  }
};

module.exports = {
  createRideRequest,
  lockRideForNegotiation,
  submitPriceProposal,
  finalizeProposal,
  startRideSession,
  completeRideSession,
  releaseStuckNegotiations,
  getRouteDistance
};