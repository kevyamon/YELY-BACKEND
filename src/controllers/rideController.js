// src/controllers/rideController.js
// CONTRÔLEUR COURSE - Flux Gamifié, Estimation & Annulation
// CSCSM Level: Bank Grade

const rideService = require('../services/rideService');
const userRepository = require('../repositories/userRepository');
const User = require('../models/User');
const AppError = require('../utils/AppError'); // 🚀 IMPORT REQUIS POUR LES ERREURS
const { successResponse, errorResponse } = require('../utils/responseHandler');

// 🚀 NOUVEAU : La fonction d'estimation (Renvoie la distance et les forfaits)
const estimateRide = async (req, res) => {
  try {
    const { pickupLat, pickupLng, dropoffLat, dropoffLng } = req.query;
    
    if (!pickupLat || !pickupLng || !dropoffLat || !dropoffLng) {
      throw new AppError('Coordonnées GPS manquantes pour l\'estimation', 400);
    }

    const origin = [parseFloat(pickupLng), parseFloat(pickupLat)];
    const destination = [parseFloat(dropoffLng), parseFloat(dropoffLat)];
    
    // On utilise le service existant pour calculer la distance réelle (en km)
    const distance = await rideService.getRouteDistance(origin, destination);
    
    // Génération des véhicules et du temps estimé selon la distance
    const vehicles = [
      { id: '1', type: 'echo', name: 'Echo', duration: Math.max(1, Math.ceil(distance * 3)) },
      { id: '2', type: 'standard', name: 'Standard', duration: Math.max(1, Math.ceil(distance * 2)) },
      { id: '3', type: 'vip', name: 'VIP', duration: Math.max(1, Math.ceil(distance * 1.5)) }
    ];

    return successResponse(res, { distance, vehicles }, 'Estimation réussie');
  } catch (error) {
    return errorResponse(res, error.message, error.statusCode || 500);
  }
};

const requestRide = async (req, res) => {
  try {
    const redisClient = req.app.get('redis');
    const { ride, drivers } = await rideService.createRideRequest(req.user._id, req.body, redisClient);
    const io = req.app.get('socketio');

    drivers.forEach(driver => {
      io.to(driver._id.toString()).emit('new_ride_request', {
        rideId: ride._id,
        origin: ride.origin.address,
        destination: ride.destination.address,
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
    const reason = req.body.reason || 'Annulé par le passager';
    
    const ride = await rideService.cancelRideByUser(rideId, req.user._id, reason);
    const io = req.app.get('socketio');

    io.to('drivers').emit('ride_taken_by_other', { rideId });

    return successResponse(res, { status: 'cancelled' }, 'Course annulée avec succès');
  } catch (error) {
    return errorResponse(res, error.message, error.statusCode || 500);
  }
};

const lockRide = async (req, res) => {
  try {
    const { rideId } = req.body;
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
    }, 'Course verrouillée');
  } catch (error) {
    return errorResponse(res, error.message, error.statusCode || 500);
  }
};

const submitPrice = async (req, res) => {
  try {
    const { rideId, amount } = req.body;
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
      }, 'Course confirmée');

    } else {
      io.to(result.rejectedDriverId.toString()).emit('proposal_rejected', {
        message: 'Prix refusé'
      });

      const newDrivers = await userRepository.findAvailableDriversNear(
        result.ride.origin.coordinates,
        5000, 
        null, 
        result.ride.rejectedDrivers
      );

      newDrivers.forEach(driver => {
        io.to(driver._id.toString()).emit('new_ride_request', {
          rideId: result.ride._id,
          origin: result.ride.origin.address,
          destination: result.ride.destination.address,
          distance: result.ride.distance,
          forfait: result.ride.forfait,
          priceOptions: result.ride.priceOptions
        });
      });

      return successResponse(res, { status: 'searching' }, 'Recherche relancée');
    }
  } catch (error) {
    return errorResponse(res, error.message, error.statusCode || 500);
  }
};

const startRide = async (req, res) => {
  try {
    const { rideId } = req.body;
    const ride = await rideService.startRideSession(req.user._id, rideId);
    
    req.app.get('socketio').to(ride.rider.toString()).emit('ride_started', { 
      rideId: ride._id, 
      startedAt: ride.startedAt 
    });
    
    return successResponse(res, { status: 'ongoing' }, 'En route');
  } catch (error) {
    return errorResponse(res, error.message, error.statusCode || 500);
  }
};

const completeRide = async (req, res) => {
  try {
    const { rideId } = req.body;
    const ride = await rideService.completeRideSession(req.user._id, rideId);
    
    const updatedDriver = await User.findById(req.user._id).select('totalRides totalEarnings rating');

    req.app.get('socketio').to(ride.rider.toString()).emit('ride_completed', { 
      rideId: ride._id, 
      finalPrice: ride.price 
    });
    
    return successResponse(res, { 
      status: 'completed', 
      finalPrice: ride.price,
      stats: {
        totalRides: updatedDriver.totalRides,
        totalEarnings: updatedDriver.totalEarnings,
        rating: updatedDriver.rating
      }
    }, 'Course achevée');
  } catch (error) {
    return errorResponse(res, error.message, error.statusCode || 500);
  }
};

// 🚀 NOUVEAU : Ajout de 'estimateRide' dans l'export
module.exports = { requestRide, cancelRide, lockRide, submitPrice, finalizeRide, startRide, completeRide, estimateRide };