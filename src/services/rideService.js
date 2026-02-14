// src/services/rideService.js
// LOGIQUE MÉTIER COURSES - Sécurité GPS, Précision Décimale & Atomicité
// CSCSM Level: Bank Grade (Forteresse)

const mongoose = require('mongoose');
const Decimal = require('decimal.js');
const Ride = require('../models/Ride');
const User = require('../models/User');
const Settings = require('../models/Settings');
const AuditLog = require('../models/AuditLog');
const AppError = require('../utils/AppError');
const logger = require('../config/logger');

/**
 * Calcul de distance (Haversine) - Recalculé côté serveur pour éviter le spoofing
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
  
  // Utilisation de Decimal pour la précision de retour
  return new Decimal(R).mul(c).toDecimalPlaces(3).toNumber();
};

/**
 * Calcule le prix final avec précision financière Decimal.js
 * @private
 */
const _computeFinalPrice = (config, distanceKm) => {
  // Calcul : Base + (Distance * Prix/Km)
  const base = new Decimal(config.base);
  const perKm = new Decimal(config.perKm);
  const dist = new Decimal(distanceKm);
  
  let total = base.plus(dist.times(perKm));
  
  // Bornes de sécurité
  const min = new Decimal(config.minPrice);
  const max = new Decimal(config.maxPrice);
  
  if (total.lt(min)) total = min;
  if (total.gt(max)) total = max;
  
  // Arrondi commercial à 50 FCFA supérieur (Standard Afrique de l'Ouest)
  // Formule : ceil(total / 50) * 50
  return total.div(50).ceil().times(50).toNumber();
};

/**
 * 1. CRÉATION D'UNE DEMANDE DE COURSE
 * 🛡️ PROTECTION : Anti-fraude GPS & Précision Décimale
 */
const createRideRequest = async (riderId, rideData) => {
  const session = await mongoose.startSession();
  let result;

  try {
    await session.withTransaction(async () => {
      const { origin, destination, forfait } = rideData;

      // A. Récupération dynamique de la configuration (Zero-Hardcoding)
      const settings = await Settings.findOne().lean().session(session);
      if (!settings) throw new AppError('Système non configuré.', 500);

      const pricing = settings.pricing?.[forfait];
      if (!pricing) throw new AppError(`Forfait ${forfait} invalide.`, 400);

      // B. Validation Géo-clôture Server-Side
      if (settings.isMapLocked && settings.allowedCenter?.coordinates) {
        const distFromCenter = _calculateAirDistanceKm(settings.allowedCenter.coordinates, origin.coordinates);
        if (distFromCenter > settings.allowedRadiusKm) {
          throw new AppError('Zone non desservie par Yély.', 403);
        }
      }

      // C. Calcul de distance (Recalculé ici, on ne fait pas confiance au client)
      const distance = _calculateAirDistanceKm(origin.coordinates, destination.coordinates);

      // 🛑 SÉCURITÉ : Seuil minimal anti-abus
      if (distance < 0.15) { 
        throw new AppError('Trajet trop court (minimum 150m).', 400);
      }

      const finalPrice = _computeFinalPrice(pricing, distance);

      // D. Création atomique de la course
      const [ride] = await Ride.create([{
        rider: riderId,
        origin,
        destination,
        forfait,
        price: finalPrice,
        distance,
        status: 'requested',
        metadata: { serverSideDistance: distance }
      }], { session });

      // E. Recherche de chauffeurs éligibles (Géo-matching)
      const availableDrivers = await User.findAvailableDriversNear(
        origin.coordinates,
        5000, 
        forfait
      ).session(session);

      if (availableDrivers.length === 0) {
        ride.status = 'cancelled';
        ride.cancellationReason = 'NO_DRIVERS_AVAILABLE';
        await ride.save({ session });
        throw new AppError('Aucun chauffeur disponible dans votre zone.', 404);
      }

      result = { ride, availableDrivers };
    });
    
    return result;
  } finally {
    session.endSession();
  }
};

/**
 * 2. ACCEPTATION D'UNE COURSE
 * 🛡️ PROTECTION : Atomicité stricte (Anti-Race Condition)
 */
const acceptRideRequest = async (driverId, rideId) => {
  const session = await mongoose.startSession();
  
  try {
    let result;
    await session.withTransaction(async () => {
      // A. Vérification de l'éligibilité temps-réel du chauffeur
      const driver = await User.findOne({
        _id: driverId,
        role: 'driver',
        isAvailable: true,
        'subscription.isActive': true
      }).session(session);

      if (!driver) throw new AppError('Éligibilité chauffeur invalide.', 403);

      // B. VERROU ATOMIQUE MONGODB
      // On cherche une course 'requested' ET on la passe en 'accepted' en une seule opération
      const ride = await Ride.findOneAndUpdate(
        { _id: rideId, status: 'requested' }, // Filtre : Doit encore être libre
        { 
          $set: { 
            driver: driverId, 
            status: 'accepted', 
            acceptedAt: new Date() 
          } 
        },
        { new: true, session }
      );

      // Si 'ride' est null, c'est qu'un autre chauffeur a validé l'update 1ms avant
      if (!ride) {
        throw new AppError('Cette course a déjà été prise par un collègue.', 410);
      }

      // C. Mise à jour du statut chauffeur
      driver.isAvailable = false;
      await driver.save({ session });

      // D. Journalisation immuable
      await AuditLog.create([{
        actor: driverId,
        action: 'ACCEPT_RIDE',
        target: ride._id,
        details: `Course ${rideId} sécurisée par ${driver.email}`
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
  
  if (!ride) throw new AppError('Statut de course incompatible pour le démarrage.', 400);
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

      if (!ride) throw new AppError('Erreur de clôture : course introuvable ou déjà finie.', 400);

      // Libération immédiate du chauffeur
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