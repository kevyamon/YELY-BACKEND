// src/services/rideService.js
// FLUX COURSE - Anti-Spam & Nettoyage Automatique
// CSCSM Level: Bank Grade

const mongoose = require('mongoose');
const Ride = require('../models/Ride');
const User = require('../models/User');
const pricingService = require('./pricingService'); // Assure-toi que ce fichier existe (Phase 3 Vague 1)
const AppError = require('../utils/AppError');

// Géométrie (Haversine)
const calculateDistanceKm = (coords1, coords2) => {
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
 * 1. CRÉER LA DEMANDE (Blindage Anti-Spam)
 */
const createRideRequest = async (riderId, rideData) => {
  // 🛡️ SÉCURITÉ : Vérifier si le Rider a déjà une course active
  const existingRide = await Ride.findOne({
    rider: riderId,
    status: { $in: ['searching', 'negotiating', 'accepted', 'ongoing'] }
  });

  if (existingRide) {
    throw new AppError('Vous avez déjà une course en cours. Terminez-la avant d\'en lancer une nouvelle.', 409);
  }

  const { origin, destination } = rideData;
  const distance = calculateDistanceKm(origin.coordinates, destination.coordinates);

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

  // Dispatch : Trouver les chauffeurs (Exclure ceux occupés)
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
 * 2. LOCKER LA COURSE (Timer lancé)
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

  if (!ride) {
    throw new AppError('Cette course a déjà été saisie par un autre chauffeur.', 409);
  }

  return ride;
};

/**
 * 3. PROPOSER PRIX (Vérification Stricte)
 */
const submitPriceProposal = async (rideId, driverId, selectedAmount) => {
  const ride = await Ride.findOne({ _id: rideId, driver: driverId, status: 'negotiating' });
  if (!ride) throw new AppError('Course non trouvée ou session expirée.', 404);

  const isValidOption = ride.priceOptions.some(opt => opt.amount === selectedAmount);
  if (!isValidOption) throw new AppError('Prix invalide (Fraude détectée).', 400);

  ride.proposedPrice = selectedAmount;
  await ride.save();

  return ride;
};

/**
 * 4. FINALISER (Anti-Usurpation ID)
 */
const finalizeProposal = async (rideId, riderId, decision) => {
  const session = await mongoose.startSession();
  let result;

  await session.withTransaction(async () => {
    // 🛡️ SÉCURITÉ : La clause `rider: riderId` empêche un hacker de valider la course d'un autre
    const ride = await Ride.findOne({ _id: rideId, rider: riderId, status: 'negotiating' }).session(session);
    
    if (!ride) throw new AppError('Demande invalide ou accès refusé.', 404);

    if (decision === 'ACCEPTED') {
      ride.status = 'accepted';
      ride.price = ride.proposedPrice;
      ride.acceptedAt = new Date();
      await ride.save({ session });
      
      await User.findByIdAndUpdate(ride.driver, { isAvailable: false }, { session });
      result = { status: 'ACCEPTED', ride };

    } else {
      const rejectedDriverId = ride.driver;
      
      ride.status = 'searching';
      ride.driver = null;
      ride.proposedPrice = null;
      ride.negotiationStartedAt = null; // Reset chrono
      ride.rejectedDrivers.push(rejectedDriverId);
      
      await ride.save({ session });
      result = { status: 'SEARCHING_AGAIN', ride, rejectedDriverId };
    }
  });

  session.endSession();
  return result;
};

// ... startRideSession et completeRideSession (inchangés) ...
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
 * 🛡️ CRON JOB : Libérer les chauffeurs bloqués
 * Appelé par le serveur toutes les minutes
 */
const releaseStuckNegotiations = async (io) => {
  const timeoutThreshold = new Date(Date.now() - 60000); // 60 secondes

  // Trouver les courses bloquées en négo depuis > 60s
  const stuckRides = await Ride.find({
    status: 'negotiating',
    negotiationStartedAt: { $lt: timeoutThreshold }
  });

  if (stuckRides.length > 0) {
    console.log(`[CLEANUP] Libération de ${stuckRides.length} courses bloquées.`);
    
    for (const ride of stuckRides) {
      const blockedDriverId = ride.driver;
      
      // Reset de la course
      ride.status = 'searching';
      ride.driver = null;
      ride.proposedPrice = null;
      ride.negotiationStartedAt = null;
      if (blockedDriverId) ride.rejectedDrivers.push(blockedDriverId); // On punit le silence par un skip
      await ride.save();

      // Notifications Socket
      if (io) {
        // Au Rider : "Le chauffeur ne répond pas"
        io.to(ride.rider.toString()).emit('negotiation_timeout', { message: "Délai dépassé. Recherche d'un autre chauffeur..." });
        
        // Au Chauffeur bloqué : "Temps écoulé"
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
  releaseStuckNegotiations // Exporté pour être utilisé dans server.js
};