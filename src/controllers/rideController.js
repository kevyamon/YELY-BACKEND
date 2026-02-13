// src/controllers/rideController.js
// CONTRÔLEUR COURSES - Transactions MongoDB, Prix recalculé côté serveur, Validation GPS
// CSCSM Level: Bank Grade

const Ride = require('../models/Ride');
const User = require('../models/User');
const Settings = require('../models/Settings');
const mongoose = require('mongoose');

// Tarifs officiels (côté serveur uniquement, jamais du client)
const OFFICIAL_PRICING = {
  ECHO: { base: 500, perKm: 300, minPrice: 800, maxPrice: 5000 },
  STANDARD: { base: 800, perKm: 400, minPrice: 1200, maxPrice: 8000 },
  VIP: { base: 1500, perKm: 700, minPrice: 2500, maxPrice: 15000 }
};

// Messages métier
const RIDE_MESSAGES = {
  CREATED: 'Course créée, recherche de chauffeur...',
  ACCEPTED: 'Course acceptée',
  STARTED: 'Course démarrée',
  COMPLETED: 'Course terminée',
  NO_DRIVERS: 'Aucun chauffeur disponible',
  INVALID_ZONE: 'Service non disponible dans cette zone',
  INVALID_STATUS: 'Statut de course invalide',
  SERVER_ERROR: 'Erreur lors du traitement'
};

/**
 * Calcule le prix officiel côté serveur (anti-manipulation)
 * @param {string} forfait - Type de forfait
 * @param {number} distanceKm - Distance en km
 * @returns {number} Prix calculé
 */
const calculateOfficialPrice = (forfait, distanceKm) => {
  const pricing = OFFICIAL_PRICING[forfait];
  if (!pricing) return 0;
  
  let price = pricing.base + (distanceKm * pricing.perKm);
  price = Math.max(pricing.minPrice, Math.min(pricing.maxPrice, price));
  return Math.round(price);
};

/**
 * @desc Demander une course avec validation zone et prix serveur
 * @route POST /api/rides/request
 */
const requestRide = async (req, res) => {
  const session = await mongoose.startSession();
  
  try {
    const result = await session.withTransaction(async () => {
      const { origin, destination, forfait, distance } = req.body;
      const io = req.app.get('socketio');

      // ═══════════════════════════════════════════════════════════
      // VALIDATION GÉOGRAPHIQUE (Lock Maféré)
      // ═══════════════════════════════════════════════════════════
      
      const settings = await Settings.findOne().session(session);
      if (settings?.isMapLocked) {
        // Vérification stricte: la ville doit être dans l'adresse
        const cityPattern = new RegExp(settings.serviceCity, 'i');
        if (!cityPattern.test(origin.address)) {
          throw new Error('OUT_OF_ZONE');
        }
        
        // Vérification coordonnées dans le rayon autorisé (si center défini)
        if (settings.allowedCenter?.coordinates) {
          const [centerLng, centerLat] = settings.allowedCenter.coordinates;
          const [originLng, originLat] = origin.coordinates;
          
          // Distance simple (approximation, suffisante pour validation zone)
          const distKm = approximateDistance(centerLat, centerLng, originLat, originLng);
          if (distKm > settings.allowedRadiusKm) {
            throw new Error('OUT_OF_RADIUS');
          }
        }
      }

      // ═══════════════════════════════════════════════════════════
      // VALIDATION FORFAIT ET PRIX
      // ═══════════════════════════════════════════════════════════
      
      if (!['ECHO', 'STANDARD', 'VIP'].includes(forfait)) {
        throw new Error('INVALID_FORFAIT');
      }

      // Recalcul prix côté serveur (ignore le prix envoyé par client)
      const distanceNum = parseFloat(distance) || 0;
      const officialPrice = calculateOfficialPrice(forfait, distanceNum);

      // ═══════════════════════════════════════════════════════════
      // CRÉATION COURSE
      // ═══════════════════════════════════════════════════════════
      
      const [ride] = await Ride.create([{
        rider: req.user._id,
        origin: {
          address: origin.address?.trim(),
          coordinates: origin.coordinates // [lng, lat]
        },
        destination: {
          address: destination.address?.trim(),
          coordinates: destination.coordinates
        },
        forfait,
        price: officialPrice, // PRIX SERVEUR UNIQUEMENT
        distance: distanceNum,
        status: 'requested'
      }], { session });

      // ═══════════════════════════════════════════════════════════
      // RECHERCHE CHAUFFEURS (avec index géospatial)
      // ═══════════════════════════════════════════════════════════
      
      const availableDrivers = await User.findAvailableDriversNear(
        origin.coordinates,
        5000, // 5km
        forfait
      ).session(session);

      if (availableDrivers.length === 0) {
        // Aucun chauffeur: annulation immédiate
        ride.status = 'cancelled';
        ride.cancellationReason = 'NO_DRIVERS_AVAILABLE';
        await ride.save({ session });
        throw new Error('NO_DRIVERS');
      }

      // ═══════════════════════════════════════════════════════════
      // NOTIFICATION CHAUFFEURS (hors transaction, non critique)
      // ═══════════════════════════════════════════════════════════
      
      // On commit d'abord, puis on notifie
      return { ride, availableDrivers, io };
    });

    // Notifications après transaction réussie
    const { ride, availableDrivers, io } = result;
    
    availableDrivers.forEach(driver => {
      io.to(driver._id.toString()).emit('new_ride_request', {
        rideId: ride._id,
        riderName: req.user.name,
        origin: ride.origin.address,
        destination: ride.destination.address,
        price: ride.price,
        distance: ride.distance,
        forfait: ride.forfait,
        expiresAt: Date.now() + 30000 // 30s pour répondre
      });
    });

    res.status(201).json({
      success: true,
      data: {
        rideId: ride._id,
        status: ride.status,
        price: ride.price,
        estimatedWait: '2-5 min'
      },
      message: RIDE_MESSAGES.CREATED
    });

  } catch (error) {
    // Gestion erreurs métier
    const businessErrors = {
      'OUT_OF_ZONE': { status: 403, message: `Désolé, Yély opère uniquement sur ${error.serviceCity || 'la zone autorisée'}.` },
      'OUT_OF_RADIUS': { status: 403, message: 'Vous êtes hors de la zone de service.' },
      'NO_DRIVERS': { status: 404, message: RIDE_MESSAGES.NO_DRIVERS },
      'INVALID_FORFAIT': { status: 400, message: 'Forfait invalide.' }
    };

    if (businessErrors[error.message]) {
      const err = businessErrors[error.message];
      return res.status(err.status).json({
        success: false,
        message: err.message,
        code: error.message
      });
    }

    console.error('[RIDE REQUEST] Erreur:', error.message);
    res.status(500).json({
      success: false,
      message: RIDE_MESSAGES.SERVER_ERROR,
      code: 'SERVER_ERROR'
    });
  } finally {
    session.endSession();
  }
};

/**
 * @desc Accepter une course (transaction critique)
 * @route POST /api/rides/accept
 */
const acceptRide = async (req, res) => {
  const session = await mongoose.startSession();
  
  try {
    const result = await session.withTransaction(async () => {
      const { rideId } = req.body;
      const io = req.app.get('socketio');

      // Validation ObjectId
      if (!mongoose.Types.ObjectId.isValid(rideId)) {
        throw new Error('INVALID_RIDE_ID');
      }

      // Récupération course avec lock
      const ride = await Ride.findOne({
        _id: rideId,
        status: 'requested'
      }).session(session);

      if (!ride) {
        throw new Error('RIDE_UNAVAILABLE');
      }

      // Vérification chauffeur éligible
      const driver = await User.findOne({
        _id: req.user._id,
        role: 'driver',
        isAvailable: true,
        'subscription.isActive': true,
        'subscription.hoursRemaining': { $gt: 0 }
      }).session(session);

      if (!driver) {
        throw new Error('DRIVER_NOT_ELIGIBLE');
      }

      // Mise à jour atomique: course + chauffeur
      ride.driver = req.user._id;
      ride.status = 'accepted';
      ride.acceptedAt = new Date();
      await ride.save({ session });

      driver.isAvailable = false;
      await driver.save({ session });

      return { ride, driver, io };
    });

    const { ride, driver, io } = result;

    // Populate rider pour la réponse
    await ride.populate('rider', 'name phone');

    // Notification client
    io.to(ride.rider._id.toString()).emit('ride_accepted', {
      rideId: ride._id,
      driverName: driver.name,
      driverPhone: driver.phone,
      vehicle: driver.vehicle,
      driverLocation: driver.currentLocation?.coordinates,
      estimatedArrival: '3-5 min'
    });

    res.json({
      success: true,
      data: {
        rideId: ride._id,
        status: ride.status,
        rider: {
          name: ride.rider.name,
          phone: ride.rider.phone
        }
      },
      message: RIDE_MESSAGES.ACCEPTED
    });

  } catch (error) {
    const businessErrors = {
      'INVALID_RIDE_ID': { status: 400, message: 'ID course invalide.' },
      'RIDE_UNAVAILABLE': { status: 410, message: 'Cette course n\'est plus disponible.' },
      'DRIVER_NOT_ELIGIBLE': { status: 403, message: 'Vous ne pouvez pas accepter de course (vérifiez abonnement ou disponibilité).' }
    };

    if (businessErrors[error.message]) {
      const err = businessErrors[error.message];
      return res.status(err.status).json({
        success: false,
        message: err.message,
        code: error.message
      });
    }

    console.error('[RIDE ACCEPT] Erreur:', error.message);
    res.status(500).json({
      success: false,
      message: RIDE_MESSAGES.SERVER_ERROR,
      code: 'SERVER_ERROR'
    });
  } finally {
    session.endSession();
  }
};

/**
 * @desc Démarrer une course
 * @route POST /api/rides/start
 */
const startRide = async (req, res) => {
  try {
    const { rideId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(rideId)) {
      return res.status(400).json({
        success: false,
        message: 'ID course invalide.',
        code: 'INVALID_RIDE_ID'
      });
    }

    const ride = await Ride.findOneAndUpdate(
      {
        _id: rideId,
        driver: req.user._id,
        status: 'accepted'
      },
      {
        status: 'ongoing',
        startedAt: new Date()
      },
      { new: true }
    );

    if (!ride) {
      return res.status(404).json({
        success: false,
        message: 'Course introuvable ou statut invalide.',
        code: 'RIDE_NOT_FOUND'
      });
    }

    // Notification client
    const io = req.app.get('socketio');
    io.to(ride.rider.toString()).emit('ride_started', {
      rideId: ride._id,
      startedAt: ride.startedAt
    });

    res.json({
      success: true,
      data: { rideId: ride._id, status: ride.status },
      message: RIDE_MESSAGES.STARTED
    });

  } catch (error) {
    console.error('[RIDE START] Erreur:', error.message);
    res.status(500).json({
      success: false,
      message: RIDE_MESSAGES.SERVER_ERROR,
      code: 'SERVER_ERROR'
    });
  }
};

/**
 * @desc Terminer une course (transaction: course + chauffeur disponible)
 * @route POST /api/rides/complete
 */
const completeRide = async (req, res) => {
  const session = await mongoose.startSession();
  
  try {
    const result = await session.withTransaction(async () => {
      const { rideId } = req.body;
      const io = req.app.get('socketio');

      if (!mongoose.Types.ObjectId.isValid(rideId)) {
        throw new Error('INVALID_RIDE_ID');
      }

      // Mise à jour course
      const ride = await Ride.findOneAndUpdate(
        {
          _id: rideId,
          driver: req.user._id,
          status: 'ongoing'
        },
        {
          status: 'completed',
          completedAt: new Date()
        },
        { new: true, session }
      );

      if (!ride) {
        throw new Error('RIDE_NOT_ONGOING');
      }

      // Remettre chauffeur disponible
      await User.findByIdAndUpdate(
        req.user._id,
        { isAvailable: true },
        { session }
      );

      return { ride, io };
    });

    const { ride, io } = result;

    // Notification client
    io.to(ride.rider.toString()).emit('ride_completed', {
      rideId: ride._id,
      completedAt: ride.completedAt,
      finalPrice: ride.price
    });

    res.json({
      success: true,
      data: {
        rideId: ride._id,
        status: ride.status,
        finalPrice: ride.price
      },
      message: RIDE_MESSAGES.COMPLETED
    });

  } catch (error) {
    const businessErrors = {
      'INVALID_RIDE_ID': { status: 400, message: 'ID course invalide.' },
      'RIDE_NOT_ONGOING': { status: 400, message: 'La course n\'est pas en cours.' }
    };

    if (businessErrors[error.message]) {
      const err = businessErrors[error.message];
      return res.status(err.status).json({
        success: false,
        message: err.message,
        code: error.message
      });
    }

    console.error('[RIDE COMPLETE] Erreur:', error.message);
    res.status(500).json({
      success: false,
      message: RIDE_MESSAGES.SERVER_ERROR,
      code: 'SERVER_ERROR'
    });
  } finally {
    session.endSession();
  }
};

// Helper: Distance approximative (formule Haversine simplifiée)
function approximateDistance(lat1, lng1, lat2, lng2) {
  const R = 6371; // Rayon terre en km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

module.exports = {
  requestRide,
  acceptRide,
  startRide,
  completeRide
};