// src/controllers/rideController.js
// CONTRÔLEUR COURSES - BLINDÉ CONTRE LA FRAUDE DE DISTANCE
// CSCSM Level: Bank Grade

const Ride = require('../models/Ride');
const User = require('../models/User');
const Settings = require('../models/Settings');
const mongoose = require('mongoose');

// Tarifs officiels
const OFFICIAL_PRICING = {
  ECHO: { base: 500, perKm: 300, minPrice: 800, maxPrice: 5000 },
  STANDARD: { base: 800, perKm: 400, minPrice: 1200, maxPrice: 8000 },
  VIP: { base: 1500, perKm: 700, minPrice: 2500, maxPrice: 15000 }
};

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

// Helper: Distance approximative (Haversine) - DÉPLACÉ EN HAUT POUR ÊTRE VISIBLE
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

const calculateOfficialPrice = (forfait, distanceKm) => {
  const pricing = OFFICIAL_PRICING[forfait];
  if (!pricing) return 0;
  
  let price = pricing.base + (distanceKm * pricing.perKm);
  price = Math.max(pricing.minPrice, Math.min(pricing.maxPrice, price));
  return Math.round(price);
};

const requestRide = async (req, res) => {
  const session = await mongoose.startSession();
  
  try {
    const result = await session.withTransaction(async () => {
      // 1. ON NE RÉCUPÈRE PLUS 'distance' DU BODY
      const { origin, destination, forfait } = req.body;
      const io = req.app.get('socketio');

      // Validation des coordonnées
      if (!origin?.coordinates || !destination?.coordinates) {
        throw new Error('INVALID_COORDINATES');
      }

      // 2. CALCUL DISTANCE CÔTÉ SERVEUR (SÉCURITÉ MAXIMALE) 🛡️
      // Le client ne peut plus mentir sur la distance.
      const calculatedDistance = approximateDistance(
        origin.coordinates[1], origin.coordinates[0], // Lat, Lng
        destination.coordinates[1], destination.coordinates[0]
      );

      // On peut ajouter une petite marge de sécurité (ex: +10% pour le trajet réel vs vol d'oiseau)
      // calculatedDistance = calculatedDistance * 1.2; 

      // 3. VALIDATION ZONE
      const settings = await Settings.findOne().session(session);
      if (settings?.isMapLocked) {
        const cityPattern = new RegExp(settings.serviceCity, 'i');
        if (!cityPattern.test(origin.address)) {
          throw new Error('OUT_OF_ZONE');
        }
        if (settings.allowedCenter?.coordinates) {
          const [centerLng, centerLat] = settings.allowedCenter.coordinates;
          const [originLng, originLat] = origin.coordinates;
          const distFromCenter = approximateDistance(centerLat, centerLng, originLat, originLng);
          if (distFromCenter > settings.allowedRadiusKm) {
            throw new Error('OUT_OF_RADIUS');
          }
        }
      }

      if (!['ECHO', 'STANDARD', 'VIP'].includes(forfait)) {
        throw new Error('INVALID_FORFAIT');
      }

      // 4. CALCUL PRIX AVEC NOTRE DISTANCE
      const officialPrice = calculateOfficialPrice(forfait, calculatedDistance);

      const [ride] = await Ride.create([{
        rider: req.user._id,
        origin: {
          address: origin.address?.trim(),
          coordinates: origin.coordinates
        },
        destination: {
          address: destination.address?.trim(),
          coordinates: destination.coordinates
        },
        forfait,
        price: officialPrice,
        distance: parseFloat(calculatedDistance.toFixed(2)), // On sauvegarde la VRAIE distance
        status: 'requested'
      }], { session });

      const availableDrivers = await User.findAvailableDriversNear(
        origin.coordinates,
        5000,
        forfait
      ).session(session);

      if (availableDrivers.length === 0) {
        ride.status = 'cancelled';
        ride.cancellationReason = 'NO_DRIVERS_AVAILABLE';
        await ride.save({ session });
        throw new Error('NO_DRIVERS');
      }

      return { ride, availableDrivers, io };
    });

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
        expiresAt: Date.now() + 30000
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
    const businessErrors = {
      'OUT_OF_ZONE': { status: 403, message: `Désolé, Yély opère uniquement sur ${error.serviceCity || 'la zone autorisée'}.` },
      'OUT_OF_RADIUS': { status: 403, message: 'Vous êtes hors de la zone de service.' },
      'NO_DRIVERS': { status: 404, message: RIDE_MESSAGES.NO_DRIVERS },
      'INVALID_FORFAIT': { status: 400, message: 'Forfait invalide.' },
      'INVALID_COORDINATES': { status: 400, message: 'Coordonnées GPS invalides.' }
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

// ... (Le reste des fonctions acceptRide, startRide, completeRide reste identique, elles sont ok)

const acceptRide = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const result = await session.withTransaction(async () => {
      const { rideId } = req.body;
      const io = req.app.get('socketio');

      if (!mongoose.Types.ObjectId.isValid(rideId)) throw new Error('INVALID_RIDE_ID');

      const ride = await Ride.findOne({ _id: rideId, status: 'requested' }).session(session);
      if (!ride) throw new Error('RIDE_UNAVAILABLE');

      const driver = await User.findOne({
        _id: req.user._id,
        role: 'driver',
        isAvailable: true,
        'subscription.isActive': true,
        'subscription.hoursRemaining': { $gt: 0 }
      }).session(session);

      if (!driver) throw new Error('DRIVER_NOT_ELIGIBLE');

      ride.driver = req.user._id;
      ride.status = 'accepted';
      ride.acceptedAt = new Date();
      await ride.save({ session });

      driver.isAvailable = false;
      await driver.save({ session });

      return { ride, driver, io };
    });

    const { ride, driver, io } = result;
    await ride.populate('rider', 'name phone');

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
        rider: { name: ride.rider.name, phone: ride.rider.phone }
      },
      message: RIDE_MESSAGES.ACCEPTED
    });

  } catch (error) {
    const businessErrors = {
      'INVALID_RIDE_ID': { status: 400, message: 'ID course invalide.' },
      'RIDE_UNAVAILABLE': { status: 410, message: 'Cette course n\'est plus disponible.' },
      'DRIVER_NOT_ELIGIBLE': { status: 403, message: 'Vous ne pouvez pas accepter de course.' }
    };
    if (businessErrors[error.message]) {
      return res.status(businessErrors[error.message].status).json({ success: false, message: businessErrors[error.message].message });
    }
    console.error('[RIDE ACCEPT] Erreur:', error.message);
    res.status(500).json({ success: false, message: RIDE_MESSAGES.SERVER_ERROR });
  } finally {
    session.endSession();
  }
};

const startRide = async (req, res) => {
  try {
    const { rideId } = req.body;
    if (!mongoose.Types.ObjectId.isValid(rideId)) return res.status(400).json({ success: false, message: 'ID invalide' });

    const ride = await Ride.findOneAndUpdate(
      { _id: rideId, driver: req.user._id, status: 'accepted' },
      { status: 'ongoing', startedAt: new Date() },
      { new: true }
    );

    if (!ride) return res.status(404).json({ success: false, message: 'Course introuvable' });

    const io = req.app.get('socketio');
    io.to(ride.rider.toString()).emit('ride_started', { rideId: ride._id, startedAt: ride.startedAt });

    res.json({ success: true, data: { rideId: ride._id, status: ride.status }, message: RIDE_MESSAGES.STARTED });
  } catch (error) {
    console.error('[RIDE START] Erreur:', error.message);
    res.status(500).json({ success: false, message: RIDE_MESSAGES.SERVER_ERROR });
  }
};

const completeRide = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const result = await session.withTransaction(async () => {
      const { rideId } = req.body;
      const io = req.app.get('socketio');

      if (!mongoose.Types.ObjectId.isValid(rideId)) throw new Error('INVALID_RIDE_ID');

      const ride = await Ride.findOneAndUpdate(
        { _id: rideId, driver: req.user._id, status: 'ongoing' },
        { status: 'completed', completedAt: new Date() },
        { new: true, session }
      );

      if (!ride) throw new Error('RIDE_NOT_ONGOING');

      await User.findByIdAndUpdate(req.user._id, { isAvailable: true }, { session });
      return { ride, io };
    });

    const { ride, io } = result;
    io.to(ride.rider.toString()).emit('ride_completed', { rideId: ride._id, completedAt: ride.completedAt, finalPrice: ride.price });

    res.json({ success: true, data: { rideId: ride._id, status: ride.status, finalPrice: ride.price }, message: RIDE_MESSAGES.COMPLETED });

  } catch (error) {
    const businessErrors = { 'INVALID_RIDE_ID': 400, 'RIDE_NOT_ONGOING': 400 };
    if (businessErrors[error.message]) return res.status(businessErrors[error.message]).json({ success: false, message: error.message });
    
    console.error('[RIDE COMPLETE] Erreur:', error.message);
    res.status(500).json({ success: false, message: RIDE_MESSAGES.SERVER_ERROR });
  } finally {
    session.endSession();
  }
};

module.exports = { requestRide, acceptRide, startRide, completeRide };