// src/repositories/userRepository.js
// DATA ACCESS OBJECT (DAO) - Utilisateurs
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
    'subscription.isActive': true, // 🛡️ Règle d'or financière garantie ici
    currentLocation: {
      $near: {
        $geometry: { type: "Point", coordinates: coordinates },
        $maxDistance: maxDistanceMeters
      }
    }
  };

  // 🛡️ Exclusion des chauffeurs ayant déjà refusé
  if (rejectedDriverIds && rejectedDriverIds.length > 0) {
    query._id = { $nin: rejectedDriverIds };
  }

  // Filtrage par catégorie de véhicule si spécifié
  if (forfait) {
    query['vehicle.category'] = forfait;
  }

  // SÉCURITÉ : On exclut le mot de passe et les données internes
  return User.find(query).select('name phone vehicle currentLocation rating fcmToken -password -__v').limit(5);
};

/**
 * Recherche des chauffeurs actifs à partir d'une liste d'IDs (Redis Geo)
 * Exclut les chauffeurs ayant déjà refusé la course
 */
const findActiveDriversByIds = async (nearbyDriverIds, rejectedDriverIds = []) => {
  return User.find({
    _id: { $in: nearbyDriverIds, $nin: rejectedDriverIds },
    role: 'driver',
    isAvailable: true,
    isBanned: false,
    'subscription.isActive': true
  }).limit(5);
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