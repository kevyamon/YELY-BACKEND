// src/controllers/rideController.js
// CONTRÔLEUR COURSES - Architecture Service
// CSCSM Level: Bank Grade

const Ride = require('../models/Ride');
const User = require('../models/User');
const Settings = require('../models/Settings');
const mongoose = require('mongoose');
const rideService = require('../services/rideService'); // Import du Service
const { successResponse, errorResponse } = require('../utils/responseHandler');

const RIDE_MESSAGES = {
  CREATED: 'Course créée, recherche de chauffeur...',
  ACCEPTED: 'Course acceptée',
  STARTED: 'Course démarrée',
  COMPLETED: 'Course terminée',
  NO_DRIVERS: 'Aucun chauffeur disponible',
  SERVER_ERROR: 'Erreur lors du traitement'
};

const requestRide = async (req, res) => {
  const session = await mongoose.startSession();
  
  try {
    const result = await session.withTransaction(async () => {
      const { origin, destination, forfait } = req.body;
      const io = req.app.get('socketio');

      // 1. VALIDATION ZONE (GEOFENCING)
      const settings = await Settings.findOne().session(session);
      if (settings?.isMapLocked) {
        const cityPattern = new RegExp(settings.serviceCity, 'i');
        if (!cityPattern.test(origin.address)) {
          throw { status: 403, message: `Service uniquement disponible à ${settings.serviceCity}.` };
        }
        
        if (settings.allowedCenter?.coordinates) {
          const distFromCenter = rideService.calculateDistanceKm(
            settings.allowedCenter.coordinates,
            origin.coordinates
          );
          if (distFromCenter > settings.allowedRadiusKm) {
            throw { status: 403, message: 'Vous êtes hors de la zone de service.' };
          }
        }
      }

      // 2. CALCULS MÉTIER (Via Service)
      const { distance, price } = rideService.computeRideDetails(
        origin.coordinates,
        destination.coordinates,
        forfait
      );

      // 3. CRÉATION COURSE
      const [ride] = await Ride.create([{
        rider: req.user._id,
        origin,
        destination,
        forfait,
        price,     // Prix calculé par le serveur
        distance,  // Distance calculée par le serveur
        status: 'requested'
      }], { session });

      // 4. RECHERCHE CHAUFFEURS
      const availableDrivers = await User.findAvailableDriversNear(
        origin.coordinates,
        5000, // 5km
        forfait
      ).session(session);

      if (availableDrivers.length === 0) {
        ride.status = 'cancelled';
        ride.cancellationReason = 'NO_DRIVERS_AVAILABLE';
        await ride.save({ session });
        throw { status: 404, message: RIDE_MESSAGES.NO_DRIVERS };
      }

      return { ride, availableDrivers, io };
    });

    // 5. NOTIFICATION (Hors transaction)
    const { ride, availableDrivers, io } = result;
    
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
    }, RIDE_MESSAGES.CREATED, 201);

  } catch (error) {
    return errorResponse(res, error.message, error.status || 500);
  } finally {
    session.endSession();
  }
};

const acceptRide = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const result = await session.withTransaction(async () => {
      const { rideId } = req.body;
      const io = req.app.get('socketio');

      const ride = await Ride.findOne({ _id: rideId, status: 'requested' }).session(session);
      if (!ride) throw { status: 410, message: 'Course non disponible.' };

      const driver = await User.findOne({
        _id: req.user._id,
        role: 'driver',
        isAvailable: true,
        'subscription.isActive': true,
        'subscription.hoursRemaining': { $gt: 0 }
      }).session(session);

      if (!driver) throw { status: 403, message: 'Chauffeur non éligible.' };

      ride.driver = req.user._id;
      ride.status = 'accepted';
      ride.acceptedAt = new Date();
      await ride.save({ session });

      driver.isAvailable = false;
      await driver.save({ session });

      return { ride, driver, io };
    });

    const { ride, driver, io } = result;
    await ride.populate('rider', 'name phone');

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
    }, RIDE_MESSAGES.ACCEPTED);

  } catch (error) {
    return errorResponse(res, error.message, error.status || 500);
  } finally {
    session.endSession();
  }
};

const startRide = async (req, res) => {
  try {
    const { rideId } = req.body;
    const ride = await Ride.findOneAndUpdate(
      { _id: rideId, driver: req.user._id, status: 'accepted' },
      { status: 'ongoing', startedAt: new Date() },
      { new: true }
    );

    if (!ride) return errorResponse(res, "Course introuvable.", 404);

    const io = req.app.get('socketio');
    io.to(ride.rider.toString()).emit('ride_started', { rideId: ride._id, startedAt: ride.startedAt });

    return successResponse(res, { rideId: ride._id, status: ride.status }, RIDE_MESSAGES.STARTED);
  } catch (error) {
    return errorResponse(res, error.message);
  }
};

const completeRide = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const result = await session.withTransaction(async () => {
      const { rideId } = req.body;
      const io = req.app.get('socketio');

      const ride = await Ride.findOneAndUpdate(
        { _id: rideId, driver: req.user._id, status: 'ongoing' },
        { status: 'completed', completedAt: new Date() },
        { new: true, session }
      );

      if (!ride) throw { status: 400, message: "Course pas en cours." };

      await User.findByIdAndUpdate(req.user._id, { isAvailable: true }, { session });
      return { ride, io };
    });

    const { ride, io } = result;
    io.to(ride.rider.toString()).emit('ride_completed', { 
      rideId: ride._id, 
      completedAt: ride.completedAt, 
      finalPrice: ride.price 
    });

    return successResponse(res, { 
      rideId: ride._id, 
      status: ride.status, 
      finalPrice: ride.price 
    }, RIDE_MESSAGES.COMPLETED);

  } catch (error) {
    return errorResponse(res, error.message, error.status || 500);
  } finally {
    session.endSession();
  }
};

module.exports = { requestRide, acceptRide, startRide, completeRide };