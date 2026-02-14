// src/controllers/rideController.js
// CONTRÔLEUR COURSES - Skinny Controller (Délègue à RideService)
// CSCSM Level: Bank Grade

const rideService = require('../services/rideService');
const { successResponse, errorResponse } = require('../utils/responseHandler');

/**
 * @desc Demander une course
 */
const requestRide = async (req, res) => {
  try {
    // Le Service gère la transaction, le pricing, et le geofencing
    const { ride, availableDrivers } = await rideService.createRideRequest(req.user._id, req.body);

    // Notification Socket (Side Effect géré par le controller ou un event emitter)
    const io = req.app.get('socketio');
    availableDrivers.forEach(driver => {
      io.to(driver._id.toString()).emit('new_ride_request', {
        rideId: ride._id,
        riderName: req.user.name,
        origin: ride.origin.address,
        destination: ride.destination.address,
        price: ride.price,
        distance: ride.distance,
        forfait: ride.forfait,
        expiresAt: Date.now() + 30000
      });
    });

    return successResponse(res, {
      rideId: ride._id,
      status: ride.status,
      price: ride.price,
      estimatedWait: '2-5 min'
    }, 'Recherche de chauffeurs...', 201);

  } catch (error) {
    return errorResponse(res, error.message, error.statusCode || 500);
  }
};

/**
 * @desc Accepter une course
 */
const acceptRide = async (req, res) => {
  try {
    const { rideId } = req.body;
    const { ride, driver } = await rideService.acceptRideRequest(req.user._id, rideId);

    // Populate rider pour la notif
    await ride.populate('rider', 'name phone');

    // Notification Socket
    const io = req.app.get('socketio');
    io.to(ride.rider._id.toString()).emit('ride_accepted', {
      rideId: ride._id,
      driverName: driver.name,
      driverPhone: driver.phone,
      vehicle: driver.vehicle,
      driverLocation: driver.currentLocation?.coordinates,
      estimatedArrival: '3-5 min'
    });

    return successResponse(res, {
      rideId: ride._id,
      status: ride.status,
      rider: { name: ride.rider.name, phone: ride.rider.phone }
    }, 'Course acceptée.');

  } catch (error) {
    return errorResponse(res, error.message, error.statusCode || 500);
  }
};

/**
 * @desc Démarrer la course
 */
const startRide = async (req, res) => {
  try {
    const { rideId } = req.body;
    const ride = await rideService.startRideSession(req.user._id, rideId);

    const io = req.app.get('socketio');
    io.to(ride.rider.toString()).emit('ride_started', { 
      rideId: ride._id, 
      startedAt: ride.startedAt 
    });

    return successResponse(res, { rideId: ride._id, status: ride.status }, 'Course démarrée.');

  } catch (error) {
    return errorResponse(res, error.message, error.statusCode || 500);
  }
};

/**
 * @desc Terminer la course
 */
const completeRide = async (req, res) => {
  try {
    const { rideId } = req.body;
    const ride = await rideService.completeRideSession(req.user._id, rideId);

    const io = req.app.get('socketio');
    io.to(ride.rider.toString()).emit('ride_completed', { 
      rideId: ride._id, 
      completedAt: ride.completedAt, 
      finalPrice: ride.price 
    });

    return successResponse(res, { 
      rideId: ride._id, 
      status: ride.status, 
      finalPrice: ride.price 
    }, 'Course terminée.');

  } catch (error) {
    return errorResponse(res, error.message, error.statusCode || 500);
  }
};

module.exports = { requestRide, acceptRide, startRide, completeRide };