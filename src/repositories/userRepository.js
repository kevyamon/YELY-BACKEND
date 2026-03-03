// src/repositories/userRepository.js
// DATA ACCESS OBJECT (DAO) - Utilisateurs
// STANDARD: Industriel (Sonde de diagnostic active)

const User = require('../models/User');
const logger = require('../config/logger');

const findAvailableDriversNear = async (coordinates, maxDistanceMeters, forfait, rejectedDriverIds = []) => {
  const safeLng = Number(coordinates[0]);
  const safeLat = Number(coordinates[1]);

  if (isNaN(safeLng) || isNaN(safeLat)) {
    logger.error('[DAO-USER] Coordonnees GPS invalides (NaN) reçues pour la recherche.');
    return []; 
  }

  const safeMaxDistance = Number(maxDistanceMeters) || 5000;

  logger.info(`[DAO-USER] Execution recherche geospatiale : Lng=${safeLng}, Lat=${safeLat}, Rayon=${safeMaxDistance}m`);

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

  if (rejectedDriverIds && rejectedDriverIds.length > 0) {
    query._id = { $nin: rejectedDriverIds };
  }

  // DESACTIVATION TEMPORAIRE DU FILTRE VEHICULE POUR LE DIAGNOSTIC
  // if (forfait) {
  //   query['vehicle.category'] = String(forfait).toUpperCase();
  // }

  try {
    const drivers = await User.find(query)
      .select('name phone vehicle currentLocation rating isAvailable')
      .limit(10)
      .lean()
      .exec();

    logger.info(`[DAO-USER] Recherche terminee. Chauffeurs trouves : ${drivers.length}`);
    
    if (drivers.length === 0) {
      // SONDE DE SECOURS : Y a-t-il des chauffeurs en ligne sur toute la planete ?
      const allActiveDrivers = await User.countDocuments({ role: 'driver', isAvailable: true, isBanned: false });
      logger.warn(`[DAO-USER] 0 chauffeur dans le rayon. Chauffeurs totaux actuellement 'en ligne' en BDD : ${allActiveDrivers}`);
    } else {
      drivers.forEach(d => logger.info(`[DAO-USER] Chauffeur cible : ${d.name} (Dispo: ${d.isAvailable})`));
    }

    return drivers;
  } catch (error) {
    logger.error(`[DAO-USER] Erreur lors de la requete MongoDB : ${error.message}`);
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