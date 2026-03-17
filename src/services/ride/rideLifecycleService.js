// src/services/ride/rideLifecycleService.js
// SERVICE METIER - Cycle de vie, creation, annulation et negociation dynamique
// STANDARD: Industriel / Bank Grade (Optimise avec Reverse Geocoding Local & Cache Redis)

const mongoose = require('mongoose');
const axios = require('axios');
const { Queue } = require('bullmq');
const Ride = require('../../models/Ride');
const User = require('../../models/User'); 
const POI = require('../../models/POI'); 
const userRepository = require('../../repositories/userRepository');
const pricingService = require('../pricingService');
const notificationService = require('../notificationService'); 
const AppError = require('../../utils/AppError');
const logger = require('../../config/logger');
const { env } = require('../../config/env');

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
  return parseFloat((R * c).toFixed(3));
};

// UTILITAIRE SENIOR : Enrichissement de l'adresse par rapport aux POIs locaux (Zero Latency via Redis)
const enrichAddressWithPOI = async (address, coords, redisClient) => {
  try {
    let pois = [];
    const cachedPOIs = await redisClient.get('yely_active_pois');
    
    if (cachedPOIs) {
      pois = JSON.parse(cachedPOIs);
    } else {
      pois = await POI.find({ isActive: true }).select('name latitude longitude').lean();
      // Mise en cache pour 1 heure (3600 secondes) pour eviter de surcharger MongoDB
      await redisClient.set('yely_active_pois', JSON.stringify(pois), 'EX', 3600); 
    }

    if (!pois || pois.length === 0) return address;

    let nearestPOI = null;
    let minDistanceKm = Infinity;

    for (const poi of pois) {
      const distKm = calculateHaversineDistance(coords, [poi.longitude, poi.latitude]);
      if (distKm < minDistanceKm) {
        minDistanceKm = distKm;
        nearestPOI = poi;
      }
    }

    const distanceInMeters = Math.round(minDistanceKm * 1000);

    // Si on est dans un rayon de 1.5 km du repere, on l'affiche
    if (distanceInMeters <= 1500 && nearestPOI) {
      const formattedDist = distanceInMeters < 1000 ? `${distanceInMeters}m` : `${(distanceInMeters / 1000).toFixed(1)}km`;
      
      // Nettoyage de l'adresse generique de Google/LocationIQ
      let baseAddress = address;
      if (address.toLowerCase().includes('maféré') || address.toLowerCase().includes('aboisso')) {
        baseAddress = 'Maféré';
      } else {
        baseAddress = address.split(',')[0].trim();
      }
      
      return `${baseAddress} (A ${formattedDist} de : ${nearestPOI.name})`;
    }

    return address;
  } catch (error) {
    logger.warn(`[POI ENRICHMENT] Echec silencieux de la contextualisation : ${error.message}`);
    return address;
  }
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

const dispatchToNearbyDrivers = async (ride, radius) => {
  const originCoords = ride.origin.coordinates;
  
  const excludedDrivers = [...(ride.rejectedDrivers || []), ...(ride.notifiedDrivers || [])];

  const drivers = await userRepository.findAvailableDriversNear(
    originCoords,
    radius,
    ride.forfait,
    excludedDrivers
  );

  if (drivers.length > 0) {
    logger.info(`[DISPATCH] ${drivers.length} nouveaux chauffeurs trouves dans un rayon de ${radius}m pour la course ${ride._id}.`);

    const driverIds = drivers.map(d => d._id);
    await Ride.findByIdAndUpdate(ride._id, { $addToSet: { notifiedDrivers: { $each: driverIds } } });

    drivers.forEach(driver => {
      notificationService.sendNotification(
        driver._id,
        'Nouvelle demande de course',
        `Course de ${ride.distance} km disponible a proximite.`,
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
        riderProfilePicture: rider?.profilePicture 
      });
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

    const { origin, destination, forfait, passengersCount } = rideData; 
    const count = passengersCount || 1;

    const originCoords = [parseFloat(origin.coordinates[0]), parseFloat(origin.coordinates[1])];
    const destCoords = [parseFloat(destination.coordinates[0]), parseFloat(destination.coordinates[1])];
    
    // APPLICATION DE L'ENRICHISSEMENT (Depart et Arrivee)
    const enrichedOriginAddress = await enrichAddressWithPOI(origin.address, originCoords, redisClient);
    const enrichedDestAddress = await enrichAddressWithPOI(destination.address, destCoords, redisClient);
    
    logger.info(`[DISPATCH] Nouvelle demande. Depart: ${enrichedOriginAddress}`);

    const distance = await getRouteDistance(originCoords, destCoords);

    if (distance < 0.1) throw new AppError('Distance invalide.', 400);

    const pricingResult = await pricingService.generatePriceOptions(originCoords, destCoords, distance, count);
    
    const initialRadius = 1000;

    const ride = await Ride.create({
      rider: riderId,
      origin: { ...origin, address: enrichedOriginAddress, coordinates: originCoords },
      destination: { ...destination, address: enrichedDestAddress, coordinates: destCoords },
      distance,
      forfait: forfait || 'STANDARD',
      passengersCount: count,
      priceOptions: pricingResult.options, 
      status: 'searching',
      rejectedDrivers: [],
      notifiedDrivers: [],
      currentSearchRadius: initialRadius
    });

    const drivers = await dispatchToNearbyDrivers(ride, initialRadius);

    await cleanupQueue.add(
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
    await session.withTransaction(async () => {
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
    });
  } finally {
    await session.endSession();
  }
  
  if (result.status === 'SEARCHING_AGAIN') {
    await cleanupQueue.add(
      'expand-search',
      { rideId },
      { delay: 0, removeOnComplete: true }
    );
  }

  return result;
};

const cancelSearchTimeout = async (io, rideId) => {
  const ride = await Ride.findOne({ _id: rideId, status: 'searching' });
  if (ride) {
    ride.status = 'cancelled';
    ride.cancellationReason = 'Temps de recherche expire, aucun chauffeur trouve.';
    await ride.save();
    
    io.to(ride.rider.toString()).emit('search_timeout', {
      message: "Aucun chauffeur n'est disponible pour le moment."
    });

    notificationService.sendNotification(
      ride.rider, "Recherche expiree", "Aucun chauffeur n'est disponible dans votre zone pour le moment.", "SEARCH_TIMEOUT", { rideId: ride._id.toString() }
    ).catch(() => {});
    
    io.emit('ride_taken_by_other', { rideId }); 

    try {
      const poiController = require('../../controllers/poiController');
      if (ride.origin?.address) await poiController.releasePendingPOI(ride.origin.address, io);
      if (ride.destination?.address) await poiController.releasePendingPOI(ride.destination.address, io);
    } catch (error) {
      logger.warn(`[POI RELEASE ERROR] Echec lors de la destruction de la course : ${error.message}`);
    }
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

    notificationService.sendNotification(
      rejectedDriverId, "Delai expire", "Le passager n'a pas repondu a temps, la course a ete relancee.", "NEGOTIATION_TIMEOUT", { rideId: ride._id.toString() }
    ).catch(() => {});

    await cleanupQueue.add(
      'expand-search',
      { rideId: ride._id },
      { delay: 0, removeOnComplete: true }
    );
  }
};

module.exports = {
  calculateHaversineDistance,
  getRouteDistance,
  createRideRequest,
  cancelRideAction,
  emergencyCancelUserRides,
  lockRideForNegotiation,
  submitPriceProposal,
  finalizeProposal,
  cancelSearchTimeout,
  releaseStuckNegotiations,
  dispatchToNearbyDrivers,
  expandSearchRadius
};