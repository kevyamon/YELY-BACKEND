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
    excludedDrivers,
    ride.type // Passer le type (RIDE ou DELIVERY)
  );

  if (drivers.length > 0) {
    logger.info(`[DISPATCH] ${drivers.length} nouveaux chauffeurs trouves dans un rayon de ${radius}m pour la course ${ride._id}.`);

    const driverIds = drivers.map(d => d._id);
    await Ride.findByIdAndUpdate(ride._id, { $addToSet: { notifiedDrivers: { $each: driverIds } } });

    drivers.forEach(driver => {
      notificationService.sendNotification(
        driver._id,
        ride.type === 'DELIVERY' ? 'Nouvelle demande de livraison' : 'Nouvelle demande de course',
        ride.type === 'DELIVERY'
          ? `Livraison de ${ride.distance} km disponible à proximité.`
          : `Course de ${ride.distance} km disponible à proximité.`,
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
        riderProfilePicture: rider?.profilePicture,
        collectionPoints: ride.collectionPoints,
        type: ride.type
      });

      notificationService.sendNotification(
        driver._id,
        ride.type === 'DELIVERY' ? 'Nouvelle demande de livraison' : 'Nouvelle demande de course',
        ride.type === 'DELIVERY'
          ? `Livraison de ${ride.distance} km disponible à proximité.`
          : `Course de ${ride.distance} km disponible à proximité.`,
        'NEW_RIDE_REQUEST',
        { rideId: ride._id.toString() }
      ).catch(err => logger.error(`[PUSH ERROR] Echec d'envoi au chauffeur ${driver._id}: ${err.message}`));
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
 
    const { origin, destination, forfait, passengersCount, type, orderId } = rideData; 
    const count = passengersCount || 1;
 
    const originCoords = [parseFloat(origin.coordinates[0]), parseFloat(origin.coordinates[1])];
    const destCoords = [parseFloat(destination.coordinates[0]), parseFloat(destination.coordinates[1])];
    
    // APPLICATION DE L'ENRICHISSEMENT (Depart et Arrivee)
    const enrichedOriginAddress = await enrichAddressWithPOI(origin.address, originCoords, redisClient);
    const enrichedDestAddress = await enrichAddressWithPOI(destination.address, destCoords, redisClient);
    
    logger.info(`[DISPATCH] Nouvelle demande. Depart: ${enrichedOriginAddress}`);
 
    const distance = await getRouteDistance(originCoords, destCoords);
 
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
    const User = require('../../models/User');
    await User.findByIdAndUpdate(ride.driver, { 'availability.isAvailable': true });
  }

  // --- COUPLAGE D'ANNULATION LIVRAISONS ---
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
        order.status = 'searching'; // Rebascule en recherche livreur directe
        order.driver = null;
        order.deliveryRideId = null;
        order.deliveryRetryCount = 0;
        await order.save();
        
        // Relance de la requête de course avec collectionPoints
        try {
          const redisClient = require('../../config/redis');
          const User = require('../../models/User');
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
  const ride = await Ride.findById(rideId);
  if (!ride) throw new AppError('Session introuvable.', 404);

  if (ride.type === 'DELIVERY') {
    if (ride.status !== 'searching') {
      throw new AppError('Cette livraison a déjà été acceptée par un autre livreur.', 400);
    }

    const isValidOption = ride.priceOptions.some(opt => opt.amount === selectedAmount);
    if (!isValidOption) throw new AppError('Montant non autorisé.', 400);

    ride.driver = driverId;
    ride.status = 'accepted';
    ride.proposedPrice = selectedAmount;
    ride.price = selectedAmount;
    ride.acceptedAt = new Date();
    await ride.save();

    const User = require('../../models/User');
    await User.findByIdAndUpdate(driverId, { 'availability.isAvailable': false });

    if (ride.orderId) {
      const Order = require('../../models/Order');
      await Order.findByIdAndUpdate(ride.orderId, { driver: driverId });
    }

    return ride;
  }

  if (ride.driver?.toString() !== driverId.toString() || ride.status !== 'negotiating') {
    throw new AppError('Session invalide.', 404);
  }

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
    await session.withTransaction(async () => {
      const ride = await Ride.findOne({ _id: rideId, rider: riderId, status: 'negotiating' }).session(session);
      if (!ride) throw new AppError('Session invalide.', 404);

      if (decision === 'ACCEPTED') {
        if (!ride.proposedPrice) {
          throw new AppError('Le chauffeur n\'a pas encore soumis de proposition de prix.', 400);
        }
        ride.status = 'accepted';
        ride.price = ride.proposedPrice;
        ride.acceptedAt = new Date();
        await ride.save({ session });
        
        await userRepository.updateDriverAvailability(ride.driver, false, session);
        
        // --- COUPLAGE COMMANDES MARKETPLACE ---
        if (ride.type === 'DELIVERY' && ride.orderId) {
          const Order = require('../../models/Order');
          const order = await Order.findById(ride.orderId).session(session);
          if (order) {
            order.driver = ride.driver;
            order.status = 'searching'; // Marque le début de la recherche du livreur sur site
            order.history.push({ status: 'searching', comment: 'Livreur attribué', timestamp: Date.now() });
            await order.save({ session });
          }
        }
        
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
    ride.cancellationReason = 'Temps de recherche expiré, aucun chauffeur trouvé.';
    await ride.save();
    
    const isDelivery = ride.type === 'DELIVERY';
    
    io.to(ride.rider.toString()).emit('search_timeout', {
      message: isDelivery 
        ? "Aucun livreur n'est disponible pour le moment."
        : "Aucun chauffeur n'est disponible pour le moment."
    });

    notificationService.sendNotification(
      ride.rider, 
      "Recherche expirée", 
      isDelivery 
        ? "Aucun livreur n'est disponible dans votre zone pour le moment."
        : "Aucun chauffeur n'est disponible dans votre zone pour le moment.", 
      "SEARCH_TIMEOUT", 
      { rideId: ride._id.toString() }
    ).catch(() => {});
    
    io.emit('ride_taken_by_other', { rideId }); 

    try {
      const poiController = require('../../controllers/poiController');
      if (ride.origin?.address) await poiController.releasePendingPOI(ride.origin.address, io);
      if (ride.destination?.address) await poiController.releasePendingPOI(ride.destination.address, io);
    } catch (error) {
      logger.warn(`[POI RELEASE ERROR] Echec lors de la destruction de la course : ${error.message}`);
    }

    // --- LOGIQUE METIER OPTION B : RELANCE AUTOMATIQUE POUR LES LIVRAISONS DE COMMANDE ---
    if (isDelivery && ride.orderId) {
      try {
        const Order = require('../../models/Order');
        const order = await Order.findById(ride.orderId).populate('seller customer');
        if (order && (order.status === 'confirmed' || order.status === 'searching')) {
          const currentRetries = order.deliveryRetryCount || 0;
          if (currentRetries < 2) {
            // Relance de niveau 2 ou 3 (jusqu'à 3 tentatives au total)
            order.deliveryRetryCount = currentRetries + 1;
            order.status = 'searching_delivery_retry';
            order.history.push({
              status: 'searching_delivery_retry',
              comment: `Recherche de livreur infructueuse (Tentative ${currentRetries + 1}/3). Nouvelle tentative automatique dans 2 minutes.`,
              timestamp: Date.now()
            });
            await order.save();

            logger.info(`[DELIVERY RETRY] Commande ${order._id} bascule en searching_delivery_retry. Tentative ${order.deliveryRetryCount}/3 dans 2 minutes.`);

            // Notifier le vendeur
            notificationService.sendNotification(
              order.seller._id,
              'Recherche de livreur infructueuse 🚴',
              `Aucun livreur trouvé pour la commande #${order._id.toString().slice(-6)}. Yély relance automatiquement une nouvelle recherche dans 2 minutes.`,
              'ORDER_UPDATE',
              { orderId: order._id.toString() }
            ).catch(() => {});

            // Notifier le client
            notificationService.sendNotification(
              order.customer._id,
              'Recherche de livreur en cours ⏳',
              `Nous élargissons nos recherches pour trouver un livreur disponible pour votre commande chez ${order.seller.name}.`,
              'ORDER_UPDATE',
              { orderId: order._id.toString() }
            ).catch(() => {});

            // Émettre les événements socket en temps réel
            if (io) {
              io.to(order.seller._id.toString()).emit('order_updated', order);
              io.to(order.customer._id.toString()).emit('order_updated', order);
            }

            // Planifier le job de retry dans 2 minutes
            await cleanupQueue.add(
              'retry-delivery-search',
              { orderId: order._id },
              { delay: 120000, removeOnComplete: true } // 2 minutes
            );
          } else {
            // Échec final après 3 tentatives (initiale + 2 retries)
            order.status = 'cancelled_no_driver';
            order.cancelledAt = Date.now();
            order.history.push({
              status: 'cancelled_no_driver',
              comment: 'Annulation automatique : Aucun livreur disponible après 3 tentatives de dispatch.',
              timestamp: Date.now()
            });
            await order.save();

            logger.warn(`[DELIVERY FAIL] Echec définitif après 3 tentatives pour la commande ${order._id}. Commande annulée.`);

            // Notifier le vendeur
            notificationService.sendNotification(
              order.seller._id,
              'Commande annulée',
              `La commande #${order._id.toString().slice(-6)} a été annulée car aucun livreur n'a pu être trouvé à proximité après 3 tentatives.`,
              'ORDER_CANCELLED',
              { orderId: order._id.toString() }
            ).catch(() => {});

            // Notifier le client
            notificationService.sendNotification(
              order.customer._id,
              'Commande annulée',
              `Votre commande chez ${order.seller.name} a été annulée car aucun livreur n'est actuellement disponible dans votre zone.`,
              'ORDER_CANCELLED',
              { orderId: order._id.toString() }
            ).catch(() => {});

            if (io) {
              io.to(order.seller._id.toString()).emit('order_updated', order);
              io.to(order.customer._id.toString()).emit('order_updated', order);
            }
          }
        }
      } catch (orderRetryError) {
        logger.error(`[DELIVERY RETRY ERROR] Erreur lors de la gestion du retry pour le ride ${rideId} : ${orderRetryError.message}`);
      }
    }
  }
};

const retryDeliverySearch = async (io, orderId) => {
  try {
    const Order = require('../../models/Order');
    const order = await Order.findById(orderId).populate('customer seller');
    if (!order) {
      logger.error(`[DELIVERY RETRY] Commande ${orderId} introuvable.`);
      return;
    }

    if (order.status !== 'searching_delivery_retry') {
      logger.info(`[DELIVERY RETRY] Commande ${orderId} n'est plus en attente de retry (statut actuel: ${order.status}). Relance annulée.`);
      return;
    }

    order.status = 'searching';
    order.history.push({
      status: 'searching',
      comment: `Relance automatique de la recherche de livreur (Tentative ${order.deliveryRetryCount + 1}/3)`,
      timestamp: Date.now()
    });
    await order.save();

    logger.info(`[DELIVERY RETRY] Relance de la recherche de livreur pour la commande ${order._id}`);

    const User = require('../../models/User');
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

    const redis = require('../../config/redis');
    const { ride, drivers } = await createRideRequest(order.customer._id, deliveryData, redis);
    
    order.deliveryRideId = ride._id;
    await order.save();

    notificationService.sendNotification(
      order.seller._id,
      'Recherche de livreur relancée',
      `Nous recherchons à nouveau un livreur pour votre commande #${order._id.toString().slice(-6)}.`,
      'ORDER_UPDATE',
      { orderId: order._id.toString() }
    ).catch(() => {});

    if (drivers && drivers.length > 0 && io) {
      const customer = await User.findById(order.customer).select('name profilePicture');
      drivers.forEach(driver => {
        io.to(driver._id.toString()).emit('new_ride_request', {
          rideId: ride._id,
          origin: ride.origin,       
          destination: ride.destination, 
          distance: ride.distance,
          forfait: ride.forfait,
          passengersCount: ride.passengersCount,
          priceOptions: ride.priceOptions,
          riderName: customer?.name || 'Client',
          riderProfilePicture: customer?.profilePicture,
          collectionPoints: ride.collectionPoints,
          type: 'DELIVERY'
        });
      });
    }

    if (io) {
      io.to(order.seller._id.toString()).emit('order_updated', order);
      io.to(order.customer._id.toString()).emit('order_updated', order);
    }
  } catch (error) {
    logger.error(`[DELIVERY RETRY PROCESS ERROR] Echec lors du traitement du retry pour la commande ${orderId} : ${error.message}`);
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
      rejectedDriverId, "Délai expiré", "Le passager n'a pas répondu à temps, la course a été relancée.", "NEGOTIATION_TIMEOUT", { rideId: ride._id.toString() }
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
  expandSearchRadius,
  retryDeliverySearch
};