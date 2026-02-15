// src/services/rideService.js
// LOGIQUE MÉTIER COURSES - Sécurité GPS, Précision Décimale & Atomicité
// CSCSM Level: Bank Grade

const mongoose = require('mongoose');
const Decimal = require('decimal.js');
const Ride = require('../models/Ride');
const User = require('../models/User');
const Settings = require('../models/Settings');
const AuditLog = require('../models/AuditLog');
const AppError = require('../utils/AppError');

/**
 * Calcul de distance (Haversine) - Protection Spoofing
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
  return new Decimal(R).mul(c).toDecimalPlaces(3).toNumber();
};

/**
 * Calcul de prix précis (FCFA)
 */
const _computeFinalPrice = (config, distanceKm) => {
  const base = new Decimal(config.base);
  const perKm = new Decimal(config.perKm);
  const dist = new Decimal(distanceKm);
  let total = base.plus(dist.times(perKm));
  
  const min = new Decimal(config.minPrice);
  const max = new Decimal(config.maxPrice);
  if (total.lt(min)) total = min;
  if (total.gt(max)) total = max;
  
  // Arrondi commercial 50 FCFA
  return total.div(50).ceil().times(50).toNumber();
};

/**
 * 1. CRÉATION D'UNE DEMANDE
 */
const createRideRequest = async (riderId, rideData) => {
  const session = await mongoose.startSession();
  let result;

  try {
    await session.withTransaction(async () => {
      const { origin, destination, forfait } = rideData;

      const settings = await Settings.findOne().lean().session(session);
      if (!settings) throw new AppError('Système non configuré.', 500);

      const pricing = settings.pricing?.[forfait];
      if (!pricing) throw new AppError(`Forfait ${forfait} invalide.`, 400);

      // Validation Géo-clôture
      if (settings.isMapLocked && settings.allowedCenter?.coordinates) {
        const distFromCenter = _calculateAirDistanceKm(settings.allowedCenter.coordinates, origin.coordinates);
        if (distFromCenter > settings.allowedRadiusKm) {
          throw new AppError('Zone non desservie par Yély.', 403);
        }
      }

      const distance = _calculateAirDistanceKm(origin.coordinates, destination.coordinates);
      if (distance < 0.15) throw new AppError('Trajet trop court (minimum 150m).', 400);

      const finalPrice = _computeFinalPrice(pricing, distance);

      const [ride] = await Ride.create([{
        rider: riderId,
        origin,
        destination,
        forfait,
        price: finalPrice,
        distance,
        status: 'requested'
      }], { session });

      const availableDrivers = await User.findAvailableDriversNear(origin.coordinates, 5000, forfait).session(session);

      if (availableDrivers.length === 0) {
        // 🛑 On marque comme annulé mais on garde la transaction pour historiser la demande
        ride.status = 'cancelled';
        ride.cancellationReason = 'NO_DRIVERS_AVAILABLE';
        await ride.save({ session });
        
        // Log d'échec
        await AuditLog.create([{
          actor: riderId,
          action: 'RIDE_REQUEST_FAILED',
          target: ride._id,
          details: 'Aucun chauffeur disponible.'
        }], { session });
        
        result = { ride, availableDrivers: [], error: 'Aucun chauffeur disponible.' };
        return;
      }

      await AuditLog.create([{
        actor: riderId,
        action: 'CREATE_RIDE',
        target: ride._id,
        details: `Course demandée: ${finalPrice} FCFA`
      }], { session });

      result = { ride, availableDrivers };
    });
    
    // Si on a retourné un résultat avec erreur, on gère la réponse
    if (result.error) throw new AppError(result.error, 404);
    return result;
  } finally {
    session.endSession();
  }
};

/**
 * 2. ACCEPTATION (Verrou Atomique)
 */
const acceptRideRequest = async (driverId, rideId) => {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const driver = await User.findOne({ _id: driverId, role: 'driver', isAvailable: true, 'subscription.isActive': true }).session(session);
      if (!driver) throw new AppError('Éligibilité chauffeur invalide.', 403);

      const ride = await Ride.findOneAndUpdate(
        { _id: rideId, status: 'requested' },
        { $set: { driver: driverId, status: 'accepted', acceptedAt: new Date() } },
        { new: true, session }
      );

      if (!ride) throw new AppError('Cette course a déjà été prise.', 410);

      driver.isAvailable = false;
      await driver.save({ session });

      await AuditLog.create([{
        actor: driverId,
        action: 'ACCEPT_RIDE',
        target: ride._id,
        details: `Course sécurisée par chauffeur ID: ${driverId}`
      }], { session });

      result = { ride, driver };
    });
    return result;
  } finally {
    session.endSession();
  }
};

const startRideSession = async (driverId, rideId) => {
  const ride = await Ride.findOneAndUpdate(
    { _id: rideId, driver: driverId, status: 'accepted' },
    { $set: { status: 'ongoing', startedAt: new Date() } },
    { new: true }
  );
  if (!ride) throw new AppError('Action impossible : vérifiez le statut de la course.', 400);
  return ride;
};

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
      if (!ride) throw new AppError('Erreur de clôture.', 400);

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
  calculateDistanceKm: _calculateAirDistanceKm 
};