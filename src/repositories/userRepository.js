// backend/src/repositories/userRepository.js
// DATA ACCESS OBJECT (DAO) - Utilisateurs (CORRIGÉ PROJECTION MONGO)
// CSCSM Level: Bank Grade

const User = require('../models/User');

/**
 * Recherche des chauffeurs disponibles par proximité géospatiale
 * Exclut ceux qui sont bannis, inactifs, ou sans abonnement valide.
 * Permet aussi d'exclure les chauffeurs ayant déjà refusé la course.
 */
const findAvailableDriversNear = async (coordinates, maxDistanceMeters, forfait, rejectedDriverIds = []) => {
  const query = {
    role: 'driver',
    isAvailable: true,
    isBanned: false,
    'subscription.isActive': true, 
    currentLocation: {
      $near: {
        $geometry: { 
          type: "Point", 
          coordinates: [parseFloat(coordinates[0]), parseFloat(coordinates[1])] 
        },
        $maxDistance: parseInt(maxDistanceMeters, 10)
      }
    }
  };

  if (Array.isArray(rejectedDriverIds) && rejectedDriverIds.length > 0) {
    query._id = { $nin: rejectedDriverIds };
  }

  if (forfait) {
    query['vehicle.category'] = forfait;
  }

  // 🛡️ CORRECTION : Uniquement des inclusions. MongoDB exclut le password automatiquement.
  return User.find(query)
    .select('name phone vehicle currentLocation rating fcmToken')
    .limit(5);
};

/**
 * Recherche des chauffeurs actifs à partir d'une liste d'IDs (Redis Geo Fallback)
 */
const findActiveDriversByIds = async (nearbyDriverIds, rejectedDriverIds = []) => {
  const query = {
    _id: { $in: nearbyDriverIds },
    role: 'driver',
    isAvailable: true,
    isBanned: false,
    'subscription.isActive': true
  };

  if (Array.isArray(rejectedDriverIds) && rejectedDriverIds.length > 0) {
    query._id.$nin = rejectedDriverIds;
  }

  return User.find(query).limit(5);
};

/**
 * Met à jour la disponibilité d'un chauffeur (Supporte les transactions Mongoose)
 */
const updateDriverAvailability = async (driverId, isAvailable, session = null) => {
  const options = session ? { session } : {};
  return User.findByIdAndUpdate(driverId, { isAvailable }, options);
};

module.exports = {
  findAvailableDriversNear,
  findActiveDriversByIds,
  updateDriverAvailability
};