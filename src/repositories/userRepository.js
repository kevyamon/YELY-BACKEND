// src/repositories/userRepository.js
// DATA ACCESS OBJECT (DAO) - Utilisateurs
// STANDARD: Industriel (Recherche assouplie et securisee)

const User = require('../models/User');

const findAvailableDriversNear = async (coordinates, maxDistanceMeters, forfait, rejectedDriverIds = []) => {
  // Tolérance : On cast directement sans faire de blocage de type array strict
  const safeLng = Number(coordinates[0]);
  const safeLat = Number(coordinates[1]);

  if (isNaN(safeLng) || isNaN(safeLat)) {
    return []; // Fallback silencieux plutôt que de faire crasher la route
  }

  const safeMaxDistance = Number(maxDistanceMeters) || 5000;

  const query = {
    role: 'driver',
    isAvailable: true,
    isBanned: false,
    currentLocation: {
      $near: {
        $geometry: { type: "Point", coordinates: [safeLng, safeLat] },
        $maxDistance: safeMaxDistance
      }
    }
  };

  // Filtrage robuste des chauffeurs ayant déjà refusé
  if (rejectedDriverIds && rejectedDriverIds.length > 0) {
    query._id = { $nin: rejectedDriverIds };
  }

  // SECURITE CRITIQUE : On force la MAJUSCULE pour correspondre à l'Enum de User.js
  if (forfait) {
    query['vehicle.category'] = String(forfait).toUpperCase();
  }

  return User.find(query)
    .select('name phone vehicle currentLocation rating fcmToken')
    .limit(10)
    .lean()
    .exec();
};

const findActiveDriversByIds = async (nearbyDriverIds, rejectedDriverIds = []) => {
  if (!nearbyDriverIds || nearbyDriverIds.length === 0) return [];

  const query = {
    _id: { $in: nearbyDriverIds },
    role: 'driver',
    isAvailable: true,
    isBanned: false
  };

  if (rejectedDriverIds && rejectedDriverIds.length > 0) {
    query._id.$nin = rejectedDriverIds;
  }

  return User.find(query)
    .select('name phone vehicle currentLocation rating fcmToken')
    .limit(10)
    .lean()
    .exec();
};

const updateDriverAvailability = async (driverId, isAvailable, session = null) => {
  const options = session ? { session } : {};
  return User.findByIdAndUpdate(driverId, { isAvailable }, options);
};

module.exports = {
  findAvailableDriversNear,
  findActiveDriversByIds,
  updateDriverAvailability
};