// src/services/rideService.js
// FLUX COURSE - Cartographie Réelle, Négociation & Anti-Spam
// CSCSM Level: Bank Grade

const mongoose = require('mongoose');
const axios = require('axios'); // Pour OSRM
const Ride = require('../models/Ride');
const User = require('../models/User');
const pricingService = require('./pricingService');
const AppError = require('../utils/AppError');
const logger = require('../config/logger');

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
 * 🗺️ CALCUL DISTANCE RÉELLE (ROUTING)
 * Appelle OSRM pour avoir la distance par la route.
 */
const getRouteDistance = async (originCoords, destCoords) => {
  try {
    // URL OSRM public (Pour la prod, héberger son propre OSRM est recommandé)
    const url = `http://router.project-osrm.org/route/v1/driving/${originCoords[0]},${originCoords[1]};${destCoords[0]},${destCoords[1]}?overview=false`;
    
    // Timeout court (1.5s) pour ne pas bloquer le serveur
    const response = await axios.get(url, { timeout: 1500 });

    if (response.data && response.data.routes && response.data.routes.length > 0) {
      const distanceMeters = response.data.routes[0].distance;
      return parseFloat((distanceMeters / 1000).toFixed(2)); // Retourne en Km
    }
    throw new Error('No route found');
  } catch (error) {
    logger.warn(`[ROUTING FAIL] OSRM error, fallback to Haversine: ${error.message}`);
    const directDist = calculateHaversineDistance(originCoords, destCoords);
    return parseFloat((directDist * 1.3).toFixed(2)); // x1.3 pour estimer la route
  }
};

/**
 * 1. CRÉER LA DEMANDE (Rider)
 */
const createRideRequest = async (riderId, rideData) => {
  // 🛡️ SÉCURITÉ : Anti-Spam (Une seule course active)
  const existingRide = await Ride.findOne({
    rider: riderId,
    status: { $in: ['searching', 'negotiating', 'accepted', 'ongoing'] }
  });
  if (existingRide) throw new AppError('Vous avez déjà une course active.', 409);

  const { origin, destination } = rideData;
  
  // ✅ APPEL SERVICE CARTOGRAPHIE (Ou Fallback)
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

  // Dispatch : Trouver les chauffeurs (Exclure ceux occupés ou rejetés)
  const drivers = await User.find({
    role: 'driver',
    isAvailable: true,
    isBanned: false,
    _id: { $nin: ride.rejectedDrivers },
    currentLocation: {
      $near: {
        $geometry: { type: 'Point', coordinates: origin.coordinates },
        $maxDistance: 5000 
      }
    }
  }).limit(5);

  return { ride, drivers };
};

/**
 * 2. LOCKER LA COURSE (Driver)
 */
const lockRideForNegotiation = async (rideId, driverId) => {
  const ride = await Ride.findOneAndUpdate(
    { _id: rideId, status: 'searching' },
    { 
      status: 'negotiating', 
      driver: driverId,
      negotiationStartedAt: new Date() // ⏱️ Top départ chrono
    },
    { new: true }
  );

  if (!ride) throw new AppError('Course déjà prise par un autre chauffeur.', 409);
  return ride;
};

/**
 * 3. PROPOSER PRIX (Driver)
 */
const submitPriceProposal = async (rideId, driverId, selectedAmount) => {
  const ride = await Ride.findOne({ _id: rideId, driver: driverId, status: 'negotiating' });
  if (!ride) throw new AppError('Course expirée ou invalide.', 404);

  // Vérification stricte que le prix est dans les options
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
    // 🛡️ SÉCURITÉ : Vérification ID Rider
    const ride = await Ride.findOne({ _id: rideId, rider: riderId, status: 'negotiating' }).session(session);
    if (!ride) throw new AppError('Demande invalide.', 404);

    if (decision === 'ACCEPTED') {
      ride.status = 'accepted';
      ride.price = ride.proposedPrice;
      ride.acceptedAt = new Date();
      await ride.save({ session });
      
      await User.findByIdAndUpdate(ride.driver, { isAvailable: false }, { session });
      result = { status: 'ACCEPTED', ride };

    } else {
      // SOFT REJECT : On libère la course, on bloque ce chauffeur
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
  const ride = await Ride.findOneAndUpdate({ _id: rideId, driver: driverId, status: 'accepted' }, { status: 'ongoing', startedAt: new Date() }, { new: true });
  if (!ride) throw new AppError('Action impossible.', 400);
  return ride;
};

const completeRideSession = async (driverId, rideId) => {
  const session = await mongoose.startSession();
  let result;
  await session.withTransaction(async () => {
    const ride = await Ride.findOneAndUpdate({ _id: rideId, driver: driverId, status: 'ongoing' }, { status: 'completed', completedAt: new Date() }, { new: true, session });
    if (!ride) throw new AppError('Action impossible.', 400);
    await User.findByIdAndUpdate(driverId, { isAvailable: true }, { session });
    result = ride;
  });
  session.endSession();
  return result;
};

/**
 * 🛡️ CRON : Libérer les chauffeurs bloqués (> 60s)
 */
const releaseStuckNegotiations = async (io) => {
  const timeoutThreshold = new Date(Date.now() - 60000); 
  const stuckRides = await Ride.find({
    status: 'negotiating',
    negotiationStartedAt: { $lt: timeoutThreshold }
  });

  if (stuckRides.length > 0) {
    console.log(`[CLEANUP] Libération de ${stuckRides.length} courses bloquées.`);
    for (const ride of stuckRides) {
      const blockedDriverId = ride.driver;
      ride.status = 'searching';
      ride.driver = null;
      ride.proposedPrice = null;
      ride.negotiationStartedAt = null;
      if (blockedDriverId) ride.rejectedDrivers.push(blockedDriverId);
      await ride.save();

      if (io) {
        io.to(ride.rider.toString()).emit('negotiation_timeout', { message: "Délai dépassé. Recherche d'un autre chauffeur..." });
        if (blockedDriverId) {
          io.to(blockedDriverId.toString()).emit('negotiation_cancelled', { message: "Temps de réponse écoulé." });
        }
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