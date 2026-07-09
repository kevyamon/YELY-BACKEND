// src/repositories/userRepository.js
// DATA ACCESS OBJECT (DAO) - Utilisateurs
// STANDARD: Industriel (Sonde de diagnostic active)

const User = require('../models/User');
const Settings = require('../models/Settings');
const logger = require('../config/logger');
const redisClient = require('../config/redis');

const calculateHaversineDistance = (coords1, coords2) => {
  const lon1 = coords1[0];
  const lat1 = coords1[1];
  const lon2 = coords2[0];
  const lat2 = coords2[1];
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const VEHICLE_CAPACITIES = {
  apsonic: 6,
  tvs: 4,
  salonie: 4
};

const findAvailableDriversNear = async (coordinates, maxDistanceMeters, forfait, rejectedDriverIds = [], missionType = 'RIDE', passengersCount = 1) => {
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
    isBanned: false,
    verificationStatus: 'approved' // Uniquement les chauffeurs approuvés par l'administration
  };

  // Pooling intelligent: Si la course demandée est ECO, on inclut aussi les chauffeurs occupés (isAvailable: false)
  if (missionType === 'RIDE' && forfait === 'ECO') {
    query.$or = [
      { isAvailable: true },
      { isAvailable: false }
    ];
  } else {
    query.isAvailable = true;
  }

  if (!isGlobalFreeAccess) {
    query['subscription.isActive'] = true;
  }

  if (missionType === 'DELIVERY') {
    query['deliveryPreferences.isDeliveryActive'] = { $ne: false };
    query['ledger.isBlocked'] = { $ne: true }; 
  } else {
    query['deliveryPreferences.isVtcActive'] = { $ne: false };

    // Filtre sur le modèle de tricycle selon le forfait et le nombre de passagers
    if (forfait === 'VIP') {
      // VIP = Uniquement TVS (avec rétrocompatibilité Salonie)
      query['vehicle.type'] = { $in: ['tvs', 'salonie'] };
    } else {
      // ECO (Covoiturage)
      const count = Number(passengersCount) || 1;
      if (count > 4) {
        // Plus de 4 passagers -> Uniquement Apsonic (6 places)
        query['vehicle.type'] = 'apsonic';
      } else {
        // 1 à 4 passagers -> TVS (ou Salonie historique) ou Apsonic
        query['vehicle.type'] = { $in: ['tvs', 'apsonic', 'salonie'] };
      }
    }
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
        .limit(30) // Augmenté pour permettre le filtrage asynchrone du pooling
        .lean()
        .exec();

      const sortedDrivers = driverIds
        .map(id => drivers.find(d => d._id.toString() === id))
        .filter(d => d !== undefined);
      
      drivers = sortedDrivers;
    } else {
      logger.info(`[DAO-USER] Aucun ID trouve par Redis ou geosearch desactive. Repli sur $nearSphere MongoDB...`);
      logger.info(`[DAO-USER] Query repli MongoDB: ${JSON.stringify(query)}`);
      // 3. FALLBACK MONGODB GEOSPATIAL (Si Redis a échoué ou ne renvoie rien)
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
        .limit(30)
        .lean()
        .exec();
    }

    // --- FILTRAGE DE POOLING INTELLIGENT COVOITURAGE ---
    const Ride = require('../models/Ride');
    const filteredDrivers = [];

    for (const driver of drivers) {
      if (driver.isAvailable) {
        filteredDrivers.push(driver);
        if (filteredDrivers.length >= 10) break;
        continue;
      }

      // Si le chauffeur est occupé, vérifier l'éligibilité au pooling ECO
      if (missionType === 'RIDE' && forfait === 'ECO') {
        try {
          const activeRides = await Ride.find({
            driver: driver._id,
            status: { $in: ['accepted', 'arrived', 'in_progress'] }
          });

          // 1. Pas de pooling si le chauffeur a une course VIP ou livraison
          const hasVipOrDelivery = activeRides.some(r => r.forfait === 'VIP' || r.type === 'DELIVERY');
          if (hasVipOrDelivery) continue;

          // 2. Vérifier la capacité en sièges restants
          const currentPassengers = activeRides.reduce((sum, r) => sum + (r.passengersCount || 1), 0);
          const vehicleType = driver.vehicle?.type || 'tvs';
          const vehicleCapacity = VEHICLE_CAPACITIES[vehicleType] || 4;
          const remainingSeats = vehicleCapacity - currentPassengers;

          if (remainingSeats < Number(passengersCount)) {
            continue; // Pas assez de places
          }

          // 3. Calcul du détour routier (Doit être dans la même direction / destination alignée)
          if (activeRides.length > 0) {
            const firstActiveRide = activeRides[0];
            const driverCoords = driver.currentLocation?.coordinates;
            const newPickupCoords = coordinates;
            const activeDestCoords = firstActiveRide.destination?.coordinates;

            if (driverCoords && newPickupCoords && activeDestCoords) {
              const dDirect = calculateHaversineDistance(driverCoords, activeDestCoords);
              const dCombined = calculateHaversineDistance(driverCoords, newPickupCoords) + 
                                calculateHaversineDistance(newPickupCoords, activeDestCoords);

              // Max 35% de détour
              if (dDirect > 0.05 && (dCombined / dDirect) > 1.35) {
                continue;
              }
            }
          }

          filteredDrivers.push(driver);
          if (filteredDrivers.length >= 10) break;
        } catch (poolErr) {
          logger.error(`[DAO-USER] Echec verification pooling pour ${driver._id}: ${poolErr.message}`);
        }
      }
    }

    logger.info(`[DAO-USER] MongoDB a valide ${filteredDrivers.length} chauffeurs apres filtrage de pooling.`);
    return filteredDrivers;

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