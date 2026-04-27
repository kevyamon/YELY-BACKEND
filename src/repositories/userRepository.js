// src/repositories/userRepository.js
// DATA ACCESS OBJECT (DAO) - Utilisateurs
// STANDARD: Industriel (Sonde de diagnostic active)

const User = require('../models/User');
const logger = require('../config/logger');
const redisClient = require('../config/redis');

const findAvailableDriversNear = async (coordinates, maxDistanceMeters, forfait, rejectedDriverIds = []) => {
  const safeLng = Number(coordinates[0]);
  const safeLat = Number(coordinates[1]);

  if (isNaN(safeLng) || isNaN(safeLat)) {
    logger.error('[DAO-USER] Coordonnees GPS invalides (NaN).');
    return []; 
  }

  const safeMaxDistance = Number(maxDistanceMeters) || 5000;

  try {
    // 1. RECHERCHE DANS REDIS (Haute Performance)
    // On récupère les IDs des chauffeurs dans le rayon
    const driverIds = await redisClient.geosearch(
      'active_drivers',
      'FROMLONLAT', safeLng, safeLat,
      'BYRADIUS', safeMaxDistance, 'm',
      'ASC'
    );

    if (!driverIds || driverIds.length === 0) {
      logger.info(`[DAO-USER] 0 chauffeur trouve dans Redis (Rayon: ${safeMaxDistance}m)`);
      return [];
    }

    // 2. FILTRAGE DB (Seulement pour les IDs trouvés)
    const query = {
      _id: { $in: driverIds },
      role: 'driver',
      isAvailable: true,
      isBanned: false
    };

    if (rejectedDriverIds && rejectedDriverIds.length > 0) {
      query._id.$nin = rejectedDriverIds;
    }

    const drivers = await User.find(query)
      .select('name phone vehicle currentLocation rating isAvailable')
      .limit(10)
      .lean()
      .exec();

    // Ré-ordonner selon la distance Redis (puisque $in ne garantit pas l'ordre)
    const sortedDrivers = driverIds
      .map(id => drivers.find(d => d._id.toString() === id))
      .filter(d => d !== undefined)
      .slice(0, 10);

    logger.info(`[DAO-USER] Redis a trouve ${driverIds.length} IDs, MongoDB a valide ${sortedDrivers.length} chauffeurs actifs.`);
    
    return sortedDrivers;
  } catch (error) {
    logger.error(`[DAO-USER] Erreur Pivot Redis/DB : ${error.message}`);
    return [];
  }
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