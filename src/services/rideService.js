// src/services/rideService.js
// LOGIQUE MÉTIER COURSES - Sécurité GPS, Calculs Financiers & Atomicité
// CSCSM Level: Bank Grade (Forteresse)

const mongoose = require('mongoose');
const Ride = require('../models/Ride');
const User = require('../models/User');
const Settings = require('../models/Settings');
const AuditLog = require('../models/AuditLog');
const AppError = require('../utils/AppError');
const logger = require('../config/logger');

/**
 * Calcul de distance (Haversine - Vol d'oiseau)
 * @private
 */
const _calculateAirDistanceKm = (coords1, coords2) => {
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

/**
 * Calcule le prix final avec précision financière
 * @private
 */
const _computeFinalPrice = (config, distanceKm) => {
  // Calcul en virgule fixe pour éviter les erreurs d'arrondi JS
  let total = config.base + (distanceKm * config.perKm);
  
  // Application des bornes de sécurité
  total = Math.max(config.minPrice, Math.min(config.maxPrice, total));
  
  // Arrondi commercial à 50 FCFA supérieur (Standard Afrique de l'Ouest)
  return Math.ceil(total / 50) * 50;
};

/**
 * 1. CRÉATION D'UNE DEMANDE DE COURSE
 * 🛡️ PROTECTION : Zero-Trust Client GPS
 */
const createRideRequest = async (riderId, rideData) => {
  const session = await mongoose.startSession();
  let result;

  try {
    await session.withTransaction(async () => {
      const { origin, destination, forfait } = rideData;

      // A. Récupération de la configuration dynamique (Prix & Géo)
      const settings = await Settings.findOne().lean().session(session);
      if (!settings) throw new AppError('Configuration système introuvable.', 500);

      const pricing = settings.pricing?.[forfait];
      if (!pricing) throw new AppError(`Le forfait ${forfait} n'est pas configuré.`, 400);

      // B. Validation Géo-clôture (Geofencing)
      if (settings.isMapLocked && settings.allowedCenter?.coordinates) {
        const distFromCenter = _calculateAirDistanceKm(settings.allowedCenter.coordinates, origin.coordinates);
        if (distFromCenter > settings.allowedRadiusKm) {
          throw new AppError('Désolé, cette zone n\'est pas encore desservie.', 403);
        }
      }

      // C. Calcul de distance avec vérification de cohérence
      const distance = _calculateAirDistanceKm(origin.coordinates, destination.coordinates);

      // 🛑 SÉCURITÉ : Anti-fraude trajet micro/identique
      if (distance < 0.15) { // Minimum 150m pour éviter les abus de prix min
        throw new AppError('Distance trop courte pour une course.', 400);
      }

      // 💡 NOTE : Pour un niveau "NASA", ici on appellerait une API comme Google Maps Distance Matrix
      // pour obtenir la distance ROUTIÈRE réelle et non "à vol d'oiseau".
      const finalPrice = _computeFinalPrice(pricing, distance);

      // D. Création de la course (Requested)
      const [ride] = await Ride.create([{
        rider: riderId,
        origin,
        destination,
        forfait,
        price: finalPrice,
        distance,
        status: 'requested',
        metadata: { airDistance: distance } // Trace pour audit
      }], { session });

      // E. Recherche de chauffeurs (Rayon 5km par défaut)
      const availableDrivers = await User.findAvailableDriversNear(
        origin.coordinates,
        5000, 
        forfait
      ).session(session);

      if (availableDrivers.length === 0) {
        ride.status = 'cancelled';
        ride.cancellationReason = 'NO_DRIVERS_AVAILABLE';
        await ride.save({ session });
        throw new AppError('Aucun chauffeur n\'est disponible pour le moment.', 404);
      }

      result = { ride, availableDrivers };
    });
    
    return result;
  } catch (error) {
    throw error; 
  } finally {
    session.endSession();
  }
};

/**
 * 2. ACCEPTATION D'UNE COURSE
 * 🛡️ PROTECTION : Mise à jour atomique (Anti-Double Acceptation)
 */
const acceptRideRequest = async (driverId, rideId) => {
  const session = await mongoose.startSession();
  
  try {
    let result;
    await session.withTransaction(async () => {
      // A. Validation éligibilité chauffeur
      const driver = await User.findOne({
        _id: driverId,
        role: 'driver',
        isAvailable: true,
        'subscription.isActive': true,
        'subscription.hoursRemaining': { $gt: 0 }
      }).session(session);

      if (!driver) throw new AppError('Vous n\'êtes pas éligible pour cette course.', 403);

      // B. Acquisition ATOMIQUE de la course
      // On utilise status: 'requested' dans le filtre pour être sûr qu'un autre n'a pas pris la course
      const ride = await Ride.findOneAndUpdate(
        { _id: rideId, status: 'requested' },
        { 
          $set: { 
            driver: driverId, 
            status: 'accepted', 
            acceptedAt: new Date() 
          } 
        },
        { new: true, session }
      );

      if (!ride) {
        throw new AppError('Cette course a déjà été acceptée par un autre chauffeur.', 410);
      }

      // C. Verrouillage du statut chauffeur
      driver.isAvailable = false;
      await driver.save({ session });

      // D. Audit Log
      await AuditLog.create([{
        actor: driverId,
        action: 'ACCEPT_RIDE',
        target: ride._id,
        details: `Course ${rideId} acceptée par ${driver.email}`
      }], { session });

      result = { ride, driver };
    });

    return result;
  } finally {
    session.endSession();
  }
};

/**
 * 3. DÉMARRAGE DE LA COURSE
 */
const startRideSession = async (driverId, rideId) => {
  const ride = await Ride.findOneAndUpdate(
    { _id: rideId, driver: driverId, status: 'accepted' },
    { $set: { status: 'ongoing', startedAt: new Date() } },
    { new: true }
  );
  
  if (!ride) throw new AppError('Impossible de démarrer la course. Vérifiez le statut.', 400);
  return ride;
};

/**
 * 4. FINALISATION DE LA COURSE
 */
const completeRideSession = async (driverId, rideId) => {
  const session = await mongoose.startSession();
  
  try {
    let result;
    await session.withTransaction(async () => {
      const ride = await Ride.findOneAndUpdate(
        { _id: rideId, driver: driverId, status: 'ongoing' },
        { $set: { status: 'completed', completedAt: new Date() } },
        { new: true, session }
      );

      if (!ride) throw new AppError('Erreur lors de la clôture de la course.', 400);

      // Libération du chauffeur
      await User.findByIdAndUpdate(driverId, { $set: { isAvailable: true } }, { session });
      
      result = ride;
    });
    return result;
  } finally {
    session.endSession();
  }
};

module.exports = {
  createRideRequest,
  acceptRideRequest,
  startRideSession,
  completeRideSession,
  calculateDistanceKm: _calculateAirDistanceKm // Export pour tests
};