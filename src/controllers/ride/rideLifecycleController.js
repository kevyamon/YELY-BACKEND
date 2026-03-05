// src/controllers/ride/rideLifecycleController.js
// SOUS-CONTROLEUR - Cycle de vie : Estimation, Demande, Annulation, Negociation
// STANDARD: Industriel / Bank Grade

const rideService = require('../../services/ride/rideLifecycleService'); 
const AppError = require('../../utils/AppError');
const logger = require('../../config/logger');
const { successResponse } = require('../../utils/responseHandler');
const User = require('../../models/User'); 
const Ride = require('../../models/Ride');

const estimateRide = async (req, res, next) => {
  try {
    const { pickupLat, pickupLng, dropoffLat, dropoffLng } = req.query;
    
    if (!pickupLat || !pickupLng || !dropoffLat || !dropoffLng) {
      throw new AppError('Coordonnées GPS manquantes pour l\'estimation', 400);
    }

    const origin = [parseFloat(pickupLng), parseFloat(pickupLat)];
    const destination = [parseFloat(dropoffLng), parseFloat(dropoffLat)];
    
    if (origin.some(isNaN) || destination.some(isNaN)) {
      throw new AppError('Format de coordonnées GPS invalide', 400);
    }

    const distance = await rideService.getRouteDistance(origin, destination);
    
    const vehicles = [
      { id: '1', type: 'echo', name: 'Echo', duration: Math.max(1, Math.ceil(distance * 3)) },
      { id: '2', type: 'standard', name: 'Standard', duration: Math.max(1, Math.ceil(distance * 2)) },
      { id: '3', type: 'vip', name: 'VIP', duration: Math.max(1, Math.ceil(distance * 1.5)) }
    ];

    return successResponse(res, { distance, vehicles }, 'Estimation réussie');
  } catch (error) {
    return next(error);
  }
};

const requestRide = async (req, res, next) => {
  try {
    const redisClient = req.app.get('redis');
    const io = req.app.get('socketio');
    
    const { ride, drivers } = await rideService.createRideRequest(req.user._id, req.body, redisClient);

    logger.info(`[DISPATCH] Course ${ride._id} créée (${ride.passengersCount} passagers). ${drivers.length} chauffeurs ciblés.`);

    const rider = await User.findById(req.user._id).select('name profilePicture');

    drivers.forEach(driver => {
      io.to(driver._id.toString()).emit('new_ride_request', {
        rideId: ride._id,
        origin: ride.origin,       
        destination: ride.destination, 
        distance: ride.distance,
        forfait: ride.forfait,
        passengersCount: ride.passengersCount,
        priceOptions: ride.priceOptions,
        riderName: rider.name,
        riderProfilePicture: rider.profilePicture 
      });
    });

    return successResponse(res, { rideId: ride._id, status: ride.status }, 'Recherche en cours', 201);
  } catch (error) {
    return next(error);
  }
};

const cancelRide = async (req, res, next) => {
  try {
    const rideId = req.params.id || req.body.rideId; 
    const reason = req.body.reason || `Annulé par le ${req.user.role}`;
    
    if (!rideId) {
      throw new AppError('L\'identifiant de la course est manquant.', 400);
    }

    const ride = await rideService.cancelRideAction(rideId, req.user._id, req.user.role, reason);
    const io = req.app.get('socketio');

    if (req.user.role === 'rider' && ride.driver) {
       io.to(ride.driver.toString()).emit('ride_cancelled', { rideId });
    } else if (req.user.role === 'driver') {
       io.to(ride.rider.toString()).emit('ride_cancelled', { rideId });
    }

    return successResponse(res, { status: 'cancelled' }, 'Course annulée avec succès');
  } catch (error) {
    return next(error);
  }
};

const emergencyCancel = async (req, res, next) => {
  try {
    const result = await rideService.emergencyCancelUserRides(req.user._id);
    const io = req.app.get('socketio');

    if (result.driversFreed && result.driversFreed.length > 0) {
      result.driversFreed.forEach(driverId => {
        io.to(driverId.toString()).emit('ride_cancelled', {
          message: 'La course a été annulée suite à une réinitialisation du client.'
        });
      });
    }

    return successResponse(res, result, 'Base de données nettoyée avec succès');
  } catch (error) {
    return next(error);
  }
};

const lockRide = async (req, res, next) => {
  try {
    const { rideId } = req.body;
    
    if (!rideId) {
      throw new AppError('L\'identifiant de la course est manquant.', 400);
    }

    const ride = await rideService.lockRideForNegotiation(rideId, req.user._id);
    const io = req.app.get('socketio');

    io.to(ride.rider.toString()).emit('driver_found', {
      driverName: req.user.name,
      vehicle: req.user.vehicle,
      driverProfilePicture: req.user.profilePicture 
    });

    return successResponse(res, { 
      rideId: ride._id, 
      status: ride.status, 
      priceOptions: ride.priceOptions 
    }, 'Course verrouillée');
  } catch (error) {
    return next(error);
  }
};

const submitPrice = async (req, res, next) => {
  try {
    const { rideId, amount } = req.body;
    
    if (!rideId || !amount) {
      throw new AppError('Données incomplètes pour soumettre un prix.', 400);
    }

    const ride = await rideService.submitPriceProposal(rideId, req.user._id, amount);
    const io = req.app.get('socketio');

    io.to(ride.rider.toString()).emit('price_proposal_received', {
      amount: ride.proposedPrice,
      driverName: req.user.name,
      driverProfilePicture: req.user.profilePicture 
    });

    return successResponse(res, { status: 'negotiating' }, 'Proposition transmise');
  } catch (error) {
    return next(error);
  }
};

const finalizeRide = async (req, res, next) => {
  try {
    const { rideId, decision } = req.body;
    
    if (!rideId || !decision) {
      throw new AppError('Données incomplètes pour finaliser.', 400);
    }

    const result = await rideService.finalizeProposal(rideId, req.user._id, decision);
    const io = req.app.get('socketio');

    if (result.status === 'ACCEPTED') {
      await result.ride.populate('driver', 'name phone vehicle currentLocation profilePicture');
      const driver = result.ride.driver;

      io.to(driver._id.toString()).emit('proposal_accepted', {
        rideId: result.ride._id,
        riderName: req.user.name,
        riderPhone: req.user.phone,
        riderProfilePicture: req.user.profilePicture, 
        origin: result.ride.origin,
        destination: result.ride.destination
      });

      return successResponse(res, { 
        status: 'accepted', 
        driver: { 
          name: driver.name, 
          phone: driver.phone, 
          vehicle: driver.vehicle, 
          location: driver.currentLocation,
          profilePicture: driver.profilePicture 
        } 
      }, 'Course confirmée');

    } else {
      io.to(result.rejectedDriverId.toString()).emit('proposal_rejected', {
        message: 'Prix refusé'
      });

      const newDrivers = await rideService.dispatchToNearbyDrivers(result.ride);
      const rider = await User.findById(req.user._id).select('name profilePicture');

      logger.info(`[DISPATCH-RETRY] Recherche relancée pour ${result.ride._id}. ${newDrivers.length} nouveaux chauffeurs trouvés.`);

      newDrivers.forEach(driver => {
        io.to(driver._id.toString()).emit('new_ride_request', {
          rideId: result.ride._id,
          origin: result.ride.origin,
          destination: result.ride.destination,
          distance: result.ride.distance,
          forfait: result.ride.forfait,
          passengersCount: result.ride.passengersCount,
          priceOptions: result.ride.priceOptions,
          riderName: rider.name,
          riderProfilePicture: rider.profilePicture 
        });
      });

      return successResponse(res, { status: 'searching' }, 'Recherche relancée');
    }
  } catch (error) {
    return next(error);
  }
};

const getCurrentRide = async (req, res, next) => {
  try {
    const query = {
      status: { $in: ['searching', 'negotiating', 'accepted', 'arrived', 'in_progress'] }
    };

    if (req.user.role === 'rider') {
      query.rider = req.user._id;
    } else if (req.user.role === 'driver') {
      query.driver = req.user._id;
    }

    const currentRide = await Ride.findOne(query)
      .populate('rider', 'name phone profilePicture')
      .populate('driver', 'name phone vehicle currentLocation profilePicture')
      .lean();

    if (!currentRide) {
      return successResponse(res, null, 'Aucune course en cours');
    }

    const formattedRide = {
      ...currentRide,
      id: currentRide._id,
      rideId: currentRide._id,
      riderName: currentRide.rider?.name,
      riderPhone: currentRide.rider?.phone,
      riderProfilePicture: currentRide.rider?.profilePicture,
      driverName: currentRide.driver?.name,
      driverPhone: currentRide.driver?.phone,
      driverProfilePicture: currentRide.driver?.profilePicture,
      driverLocation: currentRide.driver?.currentLocation,
    };

    return successResponse(res, formattedRide, 'Course en cours récupérée');
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  estimateRide,
  requestRide,
  cancelRide,
  emergencyCancel,
  lockRide,
  submitPrice,
  finalizeRide,
  getCurrentRide
};