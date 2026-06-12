// src/repositories/userRepository.js
// DATA ACCESS OBJECT (DAO) - Utilisateurs
// STANDARD: Industriel (Sonde de diagnostic active)

const User = require('../models/User');
const Settings = require('../models/Settings');
const logger = require('../config/logger');
const redisClient = require('../config/redis');

const findAvailableDriversNear = async (coordinates, maxDistanceMeters, forfait, rejectedDriverIds = [], missionType = 'RIDE') => {
  const safeLng = Number(coordinates[0]);
  const safeLat = Number(coordinates[1]);

  if (isNaN(safeLng) || isNaN(safeLat)) {
    logger.error('[DAO-USER] Coordonnees GPS invalides (NaN).');
    return []; 
  }

  const safeMaxDistance = Number(maxDistanceMeters) || 5000;
  let driverIds = [];
  let useRedis = true;

  try {
    // 1. RECHERCHE DANS REDIS (Haute Performance - geosearch avec repli sur georadius)
    try {
      driverIds = await redisClient.geosearch(
        'active_drivers',
        'FROMLONLAT', safeLng, safeLat,
        'BYRADIUS', safeMaxDistance, 'm',
        'ASC'
      );
    } catch (geoSearchError) {
      logger.warn(`[DAO-USER] geosearch non supporté ou échoué, repli sur georadius: ${geoSearchError.message}`);
      try {
        driverIds = await redisClient.georadius(
          'active_drivers',
          safeLng, safeLat,
          safeMaxDistance, 'm',
          'ASC'
        );
      } catch (geoRadiusError) {
        logger.error(`[DAO-USER] georadius a également échoué: ${geoRadiusError.message}`);
        useRedis = false;
      }
    }
  } catch (error) {
    logger.error(`[DAO-USER] Erreur Redis inattendue : ${error.message}`);
    useRedis = false;
  }

  // 2. CONSTITUTION DE LA REQUÊTE MONGODB
  const settings = await Settings.findOne();
  const isGlobalFreeAccess = settings?.isGlobalFreeAccess || false;

  const query = {
    role: 'driver',
    isAvailable: true,
    isBanned: false
  };

  if (!isGlobalFreeAccess) {
    query['subscription.isActive'] = true;
  }

  if (missionType === 'DELIVERY') {
    query['deliveryPreferences.isDeliveryActive'] = { $ne: false };
    query['ledger.isBlocked'] = { $ne: true }; 
  } else {
    query['deliveryPreferences.isVtcActive'] = { $ne: false };
  }

  if (rejectedDriverIds && rejectedDriverIds.length > 0) {
    query._id = { $nin: rejectedDriverIds };
  }

  logger.info(`[DAO-USER] Recherche livreurs: missionType=${missionType}, coords=[${safeLng}, ${safeLat}], maxDist=${safeMaxDistance}m, useRedis=${useRedis}`);
  if (useRedis && driverIds) {
    logger.info(`[DAO-USER] Redis active_drivers geosearch a trouve ${driverIds.length} IDs: ${JSON.stringify(driverIds)}`);
  }

  try {
    let drivers = [];

    if (useRedis && driverIds && driverIds.length > 0) {
      query._id = { ...query._id, $in: driverIds };
      logger.info(`[DAO-USER] Validation MongoDB avec query: ${JSON.stringify(query)}`);
      
      drivers = await User.find(query)
        .select('name phone vehicle currentLocation rating isAvailable')
        .limit(10)
        .lean()
        .exec();

      const sortedDrivers = driverIds
        .map(id => drivers.find(d => d._id.toString() === id))
        .filter(d => d !== undefined)
        .slice(0, 10);

      logger.info(`[DAO-USER] MongoDB a valide ${sortedDrivers.length}/${drivers.length} chauffeurs.`);
      return sortedDrivers;
    } else {
      logger.info(`[DAO-USER] Aucun ID trouve par Redis ou geosearch desactive. Repli sur $nearSphere MongoDB...`);
      logger.info(`[DAO-USER] Query repli MongoDB: ${JSON.stringify(query)}`);
      // 3. FALLBACK MONGODB GEOSPATIAL (Si Redis a échoué ou ne renvoie rien)
      logger.info(`[DAO-USER] Repli sur la recherche géospatiale MongoDB ($nearSphere)...`);
      
      query.currentLocation = {
        $nearSphere: {
          $geometry: {
            type: 'Point',
            coordinates: [safeLng, safeLat]
          },
          $maxDistance: safeMaxDistance
        }
      };

      drivers = await User.find(query)
        .select('name phone vehicle currentLocation rating isAvailable')
        .limit(10)
        .lean()
        .exec();

      logger.info(`[DAO-USER] Recherche géospatiale MongoDB a trouvé ${drivers.length} chauffeurs.`);
      return drivers;
    }
  } catch (error) {
    logger.error(`[DAO-USER] Erreur Pivot Redis/DB ou Fallback MongoDB : ${error.message}`);
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