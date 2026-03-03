// src/repositories/userRepository.js
// DATA ACCESS OBJECT (DAO) - Utilisateurs
// STANDARD: Industriel / Bank Grade

const User = require('../models/User');
const AppError = require('../utils/AppError');

const findAvailableDriversNear = async (coordinates, maxDistanceMeters, forfait, rejectedDriverIds = []) => {
  if (!Array.isArray(coordinates) || coordinates.length !== 2) {
    throw new AppError('Format de coordonnees invalide pour la recherche geospatiale.', 400);
  }

  const safeLng = parseFloat(coordinates[0]);
  const safeLat = parseFloat(coordinates[1]);

  if (isNaN(safeLng) || isNaN(safeLat)) {
    throw new AppError('Les coordonnees doivent etre des nombres valides.', 400);
  }

  const safeMaxDistance = Math.min(Math.max(parseFloat(maxDistanceMeters), 0), 50000);

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

  if (Array.isArray(rejectedDriverIds) && rejectedDriverIds.length > 0) {
    const validRejectedIds = rejectedDriverIds.filter(id => id);
    if (validRejectedIds.length > 0) {
      query._id = { $nin: validRejectedIds };
    }
  }

  if (forfait) {
    query['vehicle.category'] = forfait;
  }

  return User.find(query)
    .select('name phone vehicle currentLocation rating fcmToken')
    .limit(10)
    .lean()
    .exec();
};

const findActiveDriversByIds = async (nearbyDriverIds, rejectedDriverIds = []) => {
  if (!Array.isArray(nearbyDriverIds) || nearbyDriverIds.length === 0) return [];

  const query = {
    _id: { $in: nearbyDriverIds },
    role: 'driver',
    isAvailable: true,
    isBanned: false
  };

  if (Array.isArray(rejectedDriverIds) && rejectedDriverIds.length > 0) {
    query._id.$nin = rejectedDriverIds.filter(id => id);
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