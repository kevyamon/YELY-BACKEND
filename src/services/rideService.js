// src/services/rideService.js
// LOGIQUE MÉTIER COURSES - Transactions, Tarifs, Géométrie & Audit
// CSCSM Level: Bank Grade

const mongoose = require('mongoose');
const Ride = require('../models/Ride');
const User = require('../models/User');
const Settings = require('../models/Settings');
const AuditLog = require('../models/AuditLog'); // Traçabilité
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

    // B. Calculs Métier
    const distance = calculateDistanceKm(origin.coordinates, destination.coordinates);
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

    // D. Recherche Chauffeurs (Limitée à 10 pour perf)
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

/**
 * 2. ACCEPTER UNE COURSE
 */
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

    // Mise à jour Course
    ride.driver = driverId;
    ride.status = 'accepted';
    ride.acceptedAt = new Date();
    await ride.save({ session });

    // Mise à jour Chauffeur
    driver.isAvailable = false;
    await driver.save({ session });

    // Audit
    await AuditLog.create([{
      actor: driverId,
      action: 'APPROVE_TRANSACTION', // ou un type 'ACCEPT_RIDE' si tu l'ajoutes à l'enum
      target: ride._id,
      details: `Ride accepted by ${driver.email}`
    }], { session });

    result = { ride, driver };
  });

  session.endSession();
  return result;
};

/**
 * 3. DÉMARRER LA COURSE
 */
const startRideSession = async (driverId, rideId) => {
  const ride = await Ride.findOneAndUpdate(
    { _id: rideId, driver: driverId, status: 'accepted' },
    { status: 'ongoing', startedAt: new Date() },
    { new: true }
  );
  
  if (!ride) throw new AppError('Impossible de démarrer la course.', 400);
  return ride;
};

/**
 * 4. TERMINER LA COURSE
 */
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

    // Libérer le chauffeur
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