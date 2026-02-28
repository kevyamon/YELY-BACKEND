// src/controllers/rideController.js
const rideService = require('../services/rideService');
const userRepository = require('../repositories/userRepository');
const User = require('../models/User');
const Ride = require('../models/Ride');
const AppError = require('../utils/AppError');
const logger = require('../config/logger');
const { successResponse, errorResponse } = require('../utils/responseHandler');

const estimateRide = async (req, res) => {
  try {
    const { pickupLat, pickupLng, dropoffLat, dropoffLng } = req.query;
    
    if (!pickupLat || !pickupLng || !dropoffLat || !dropoffLng) {
      throw new AppError('Coordonnees GPS manquantes pour l\'estimation', 400);
    }

    const origin = [parseFloat(pickupLng), parseFloat(pickupLat)];
    const destination = [parseFloat(dropoffLng), parseFloat(dropoffLat)];
    
    const distance = await rideService.getRouteDistance(origin, destination);
    
    const vehicles = [
      { id: '1', type: 'echo', name: 'Echo', duration: Math.max(1, Math.ceil(distance * 3)) },
      { id: '2', type: 'standard', name: 'Standard', duration: Math.max(1, Math.ceil(distance * 2)) },
      { id: '3', type: 'vip', name: 'VIP', duration: Math.max(1, Math.ceil(distance * 1.5)) }
    ];

    return successResponse(res, { distance, vehicles }, 'Estimation reussie');
  } catch (error) {
    return errorResponse(res, error.message, error.statusCode || 500);
  }
};

const requestRide = async (req, res) => {
  try {
    const redisClient = req.app.get('redis');
    const { ride, drivers } = await rideService.createRideRequest(req.user._id, req.body, redisClient);
    const io = req.app.get('socketio');

    logger.info(`[DISPATCH] Course ${ride._id} creee. ${drivers.length} chauffeurs trouves.`);

    drivers.forEach(driver => {
      io.to(driver._id.toString()).emit('new_ride_request', {
        rideId: ride._id,
        origin: ride.origin,       
        destination: ride.destination, 
        distance: ride.distance,
        forfait: ride.forfait,
        priceOptions: ride.priceOptions
      });
    });

    return successResponse(res, { rideId: ride._id, status: ride.status }, 'Recherche en cours', 201);
  } catch (error) {
    return errorResponse(res, error.message, error.statusCode || 500);
  }
};

const cancelRide = async (req, res) => {
  try {
    const rideId = req.params.id || req.body.rideId; 
    const reason = req.body.reason || `Annule par le ${req.user.role}`;
    
    if (!rideId) {
      throw new AppError('ID de la course manquant.', 400);
    }

    const ride = await rideService.cancelRideAction(rideId, req.user._id, req.user.role, reason);
    const io = req.app.get('socketio');

    if (req.user.role === 'rider' && ride.driver) {
       io.to(ride.driver.toString()).emit('ride_cancelled', { rideId });
    } else if (req.user.role === 'driver') {
       io.to(ride.rider.toString()).emit('ride_cancelled', { rideId });
    }
    
    io.to('drivers').emit('ride_taken_by_other', { rideId });

    return successResponse(res, { status: 'cancelled' }, 'Course annulee avec succes');
  } catch (error) {
    return errorResponse(res, error.message, error.statusCode || 500);
  }
};

const emergencyCancel = async (req, res) => {
  try {
    const result = await rideService.emergencyCancelUserRides(req.user._id);
    const io = req.app.get('socketio');

    if (result.driversFreed && result.driversFreed.length > 0) {
      result.driversFreed.forEach(driverId => {
        io.to(driverId.toString()).emit('ride_cancelled', {
          message: 'La course a ete annulee suite a une reinitialisation du client.'
        });
      });
    }

    return successResponse(res, result, 'Base de donnees nettoyee avec succes');
  } catch (error) {
    return errorResponse(res, error.message, error.statusCode || 500);
  }
};

const lockRide = async (req, res) => {
  try {
    const { rideId } = req.body;
    
    if (!rideId) {
      throw new AppError('ID de la course manquant.', 400);
    }

    const ride = await rideService.lockRideForNegotiation(rideId, req.user._id);
    const io = req.app.get('socketio');

    io.to(ride.rider.toString()).emit('driver_found', {
      driverName: req.user.name,
      vehicle: req.user.vehicle
    });

    io.to('drivers').emit('ride_taken_by_other', { rideId });

    return successResponse(res, { 
      rideId: ride._id, 
      status: ride.status, 
      priceOptions: ride.priceOptions 
    }, 'Course verrouillee');
  } catch (error) {
    return errorResponse(res, error.message, error.statusCode || 500);
  }
};

const submitPrice = async (req, res) => {
  try {
    const { rideId, amount } = req.body;
    
    if (!rideId || !amount) {
      throw new AppError('Donnees incompletes.', 400);
    }

    const ride = await rideService.submitPriceProposal(rideId, req.user._id, amount);
    const io = req.app.get('socketio');

    io.to(ride.rider.toString()).emit('price_proposal_received', {
      amount: ride.proposedPrice,
      driverName: req.user.name
    });

    return successResponse(res, { status: 'negotiating' }, 'Proposition transmise');
  } catch (error) {
    return errorResponse(res, error.message, error.statusCode || 500);
  }
};

const finalizeRide = async (req, res) => {
  try {
    const { rideId, decision } = req.body;
    
    if (!rideId || !decision) {
      throw new AppError('Donnees incompletes.', 400);
    }

    const result = await rideService.finalizeProposal(rideId, req.user._id, decision);
    const io = req.app.get('socketio');

    if (result.status === 'ACCEPTED') {
      await result.ride.populate('driver', 'name phone vehicle currentLocation');
      const driver = result.ride.driver;

      io.to(driver._id.toString()).emit('proposal_accepted', {
        rideId: result.ride._id,
        riderName: req.user.name,
        riderPhone: req.user.phone,
        origin: result.ride.origin,
        destination: result.ride.destination
      });

      return successResponse(res, { 
        status: 'accepted', 
        driver: { 
          name: driver.name, 
          phone: driver.phone, 
          vehicle: driver.vehicle, 
          location: driver.currentLocation 
        } 
      }, 'Course confirmee');

    } else {
      io.to(result.rejectedDriverId.toString()).emit('proposal_rejected', {
        message: 'Prix refuse'
      });

      const maxDistance = 5000;
      const newDrivers = await userRepository.findAvailableDriversNear(
        result.ride.origin.coordinates,
        maxDistance, 
        null, 
        result.ride.rejectedDrivers
      );

      logger.info(`[DISPATCH-RETRY] Recherche relancee pour ${result.ride._id}. ${newDrivers.length} chauffeurs trouves.`);

      newDrivers.forEach(driver => {
        io.to(driver._id.toString()).emit('new_ride_request', {
          rideId: result.ride._id,
          origin: result.ride.origin,
          destination: result.ride.destination,
          distance: result.ride.distance,
          forfait: result.ride.forfait,
          priceOptions: result.ride.priceOptions
        });
      });

      return successResponse(res, { status: 'searching' }, 'Recherche relancee');
    }
  } catch (error) {
    return errorResponse(res, error.message, error.statusCode || 500);
  }
};

const startRide = async (req, res) => {
  try {
    const { rideId } = req.body;
    
    if (!rideId) {
      throw new AppError('ID de la course manquant.', 400);
    }

    const ride = await rideService.startRideSession(req.user._id, rideId);
    
    req.app.get('socketio').to(ride.rider.toString()).emit('ride_started', { 
      rideId: ride._id, 
      startedAt: ride.startedAt 
    });
    
    logger.info(`[RIDE EXECUTION] Course ${rideId} demarree (Statut: ongoing). Driver ID: ${req.user._id}`);
    
    return successResponse(res, { status: 'ongoing' }, 'En route');
  } catch (error) {
    return errorResponse(res, error.message, error.statusCode || 500);
  }
};

const completeRide = async (req, res) => {
  try {
    const { rideId } = req.body;
    
    if (!rideId) {
      throw new AppError('ID de la course manquant.', 400);
    }

    const ride = await rideService.completeRideSession(req.user._id, rideId);
    
    const updatedDriver = await User.findById(req.user._id).select('totalRides totalEarnings rating');
    const io = req.app.get('socketio');

    io.to(ride.rider.toString()).emit('ride_completed', { 
      rideId: ride._id, 
      finalPrice: ride.price 
    });

    io.to(req.user._id.toString()).emit('ride_completed', { 
      rideId: ride._id, 
      finalPrice: ride.price 
    });
    
    logger.info(`[RIDE EXECUTION] Course ${rideId} terminee. Driver ID: ${req.user._id}. Prix final: ${ride.price}`);
    
    return successResponse(res, { 
      status: 'completed', 
      finalPrice: ride.price,
      stats: {
        totalRides: updatedDriver.totalRides,
        totalEarnings: updatedDriver.totalEarnings,
        rating: updatedDriver.rating
      }
    }, 'Course achevee');
  } catch (error) {
    return errorResponse(res, error.message, error.statusCode || 500);
  }
};

// 🛡️ NOUVEAU : Traitement securise des avis clients (Moyenne arithmetique)
const rateRide = async (req, res) => {
  try {
    const rideId = req.params.id;
    const { rating, comment } = req.body;
    
    if (!rideId) throw new AppError('ID de la course manquant.', 400);
    if (!rating || rating < 1 || rating > 5) throw new AppError('Note invalide (1 a 5).', 400);

    const ride = await Ride.findById(rideId);
    if (!ride) throw new AppError('Course introuvable.', 404);

    if (ride.driver) {
      const driver = await User.findById(ride.driver);
      if (driver) {
        const currentRating = driver.rating || 5.0;
        const currentCount = driver.ratingCount || 0;
        
        const newCount = currentCount + 1;
        const newRating = ((currentRating * currentCount) + rating) / newCount;

        driver.rating = parseFloat(newRating.toFixed(2));
        driver.ratingCount = newCount;
        await driver.save();
      }
    }

    return successResponse(res, { status: 'rated' }, 'Note enregistree avec succes');
  } catch (error) {
    return errorResponse(res, error.message, error.statusCode || 500);
  }
};

module.exports = { requestRide, cancelRide, emergencyCancel, lockRide, submitPrice, finalizeRide, startRide, completeRide, estimateRide, rateRide };