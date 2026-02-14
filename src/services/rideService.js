// src/services/rideService.js
// LOGIQUE MÉTIER COURSES - Transactions, Tarifs, Géométrie & Audit
// CSCSM Level: Bank Grade

const mongoose = require('mongoose');
const Ride = require('../models/Ride');
const User = require('../models/User');
const Settings = require('../models/Settings');
const AuditLog = require('../models/AuditLog');
const AppError = require('../utils/AppError');

// Tarifs officiels
const OFFICIAL_PRICING = {
  ECHO: { base: 500, perKm: 300, minPrice: 800, maxPrice: 5000 },
  STANDARD: { base: 800, perKm: 400, minPrice: 1200, maxPrice: 8000 },
  VIP: { base: 1500, perKm: 700, minPrice: 2500, maxPrice: 15000 }
};

/**
 * Calcul de distance (Haversine)
 */
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
 * Calcul Prix
 */
const calculatePrice = (forfait, distanceKm) => {
  const pricing = OFFICIAL_PRICING[forfait];
  if (!pricing) throw new AppError('Forfait invalide.', 400);
  
  // Le prix est calculé, MAIS on applique les bornes Min/Max
  let price = pricing.base + (distanceKm * pricing.perKm);
  price = Math.max(pricing.minPrice, Math.min(pricing.maxPrice, price));
  
  return Math.ceil(price / 50) * 50; // Arrondi 50 FCFA
};

/**
 * 1. DEMANDE DE COURSE
 */
const createRideRequest = async (riderId, rideData) => {
  const session = await mongoose.startSession();
  let result;
  
  await session.withTransaction(async () => {
    const { origin, destination, forfait } = rideData;

    // A. Validation Géographique (Geofencing)
    const settings = await Settings.findOne().session(session);
    if (settings?.isMapLocked) {
      if (settings.allowedCenter?.coordinates) {
        const distFromCenter = calculateDistanceKm(settings.allowedCenter.coordinates, origin.coordinates);
        if (distFromCenter > settings.allowedRadiusKm) {
          throw new AppError('Zone non desservie.', 403);
        }
      }
    }

    // B. Calculs Métier & SÉCURITÉ ANTI-FRAUDE 🛡️
    const distance = calculateDistanceKm(origin.coordinates, destination.coordinates);

    // 🛑 PATCH SÉCURITÉ : Refus des trajets incohérents (< 100m)
    // Cela empêche l'attaque "Mêmes coordonnées" (distance = 0)
    if (distance < 0.1) {
      throw new AppError('Trajet invalide : La distance est trop courte (minimum 100m). Vérifiez vos adresses.', 400);
    }

    // 🛑 PATCH SÉCURITÉ : Vérification basique des coordonnées (Bounding Box Abidjan large)
    // Empêche d'envoyer des coordonnées à 0,0 (Océan Atlantique au large du Ghana) si c'est le défaut
    const [lng, lat] = origin.coordinates;
    if (lat === 0 && lng === 0) {
        throw new AppError('Coordonnées GPS invalides (0,0 detected).', 400);
    }

    const price = calculatePrice(forfait, distance);

    // C. Création DB
    const [ride] = await Ride.create([{
      rider: riderId,
      origin,
      destination,
      forfait,
      price,
      distance,
      status: 'requested'
    }], { session });

    // D. Recherche Chauffeurs
    const availableDrivers = await User.findAvailableDriversNear(
      origin.coordinates,
      5000, 
      forfait
    ).session(session);

    if (availableDrivers.length === 0) {
      ride.status = 'cancelled';
      ride.cancellationReason = 'NO_DRIVERS_AVAILABLE';
      await ride.save({ session });
      throw new AppError('Aucun chauffeur disponible.', 404);
    }

    result = { ride, availableDrivers };
  });

  session.endSession();
  return result;
};

// ... (Le reste des fonctions acceptRideRequest, startRideSession, completeRideSession reste identique)
// Je les remets ici pour que tu aies le fichier complet sans trou
const acceptRideRequest = async (driverId, rideId) => {
  const session = await mongoose.startSession();
  let result;

  await session.withTransaction(async () => {
    const ride = await Ride.findOne({ _id: rideId, status: 'requested' }).session(session);
    if (!ride) throw new AppError('Course indisponible.', 410);

    const driver = await User.findOne({
      _id: driverId,
      role: 'driver',
      isAvailable: true,
      'subscription.isActive': true,
      'subscription.hoursRemaining': { $gt: 0 }
    }).session(session);

    if (!driver) throw new AppError('Chauffeur non éligible ou occupé.', 403);

    ride.driver = driverId;
    ride.status = 'accepted';
    ride.acceptedAt = new Date();
    await ride.save({ session });

    driver.isAvailable = false;
    await driver.save({ session });

    await AuditLog.create([{
      actor: driverId,
      action: 'APPROVE_TRANSACTION', 
      target: ride._id,
      details: `Ride accepted by ${driver.email}`
    }], { session });

    result = { ride, driver };
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
  if (!ride) throw new AppError('Impossible de démarrer la course.', 400);
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
    if (!ride) throw new AppError('Course introuvable ou statut incorrect.', 400);

    await User.findByIdAndUpdate(driverId, { isAvailable: true }, { session });
    result = ride;
  });
  session.endSession();
  return result;
};

module.exports = {
  createRideRequest,
  acceptRideRequest,
  startRideSession,
  completeRideSession,
  calculateDistanceKm
};