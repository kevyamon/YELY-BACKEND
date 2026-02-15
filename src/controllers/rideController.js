// src/controllers/rideController.js
// CONTRÔLEUR - Orchestration Temps Réel Complète
// CSCSM Level: Bank Grade

const rideService = require('../services/rideService');
const User = require('../models/User'); // Pour re-dispatch
const { successResponse, errorResponse } = require('../utils/responseHandler');

// 1. DEMANDE INITIALE
const requestRide = async (req, res) => {
  try {
    const { ride, drivers } = await rideService.createRideRequest(req.user._id, req.body);
    const io = req.app.get('socketio');

    // 📡 EMIT: Aux 5 chauffeurs
    drivers.forEach(driver => {
      io.to(driver._id.toString()).emit('new_ride_request', {
        rideId: ride._id,
        origin: ride.origin.address,
        destination: ride.destination.address,
        distance: ride.distance,
        message: "Nouvelle course disponible !"
      });
    });

    return successResponse(res, { rideId: ride._id, status: ride.status }, 'Recherche...', 201);
  } catch (error) { return errorResponse(res, error.message, error.statusCode || 500); }
};

// 2. LOCK (Chauffeur prend)
const lockRide = async (req, res) => {
  try {
    const { rideId } = req.body;
    const ride = await rideService.lockRideForNegotiation(rideId, req.user._id);
    const io = req.app.get('socketio');

    // 📡 EMIT: Au Rider (Un chauffeur a pris)
    io.to(ride.rider.toString()).emit('driver_found', {
      message: "Un chauffeur a pris la course. Attente proposition...",
      driverName: req.user.name,
      vehicle: req.user.vehicle
    });

    // 📡 EMIT: Aux AUTRES chauffeurs (Trop tard)
    io.to('drivers').emit('ride_taken_by_other', { rideId });

    return successResponse(res, { 
      rideId: ride._id, 
      status: ride.status, 
      priceOptions: ride.priceOptions 
    }, 'Course verrouillée.');
  } catch (error) { return errorResponse(res, error.message, error.statusCode || 500); }
};

// 3. PROPOSITION (Chauffeur envoie prix)
const submitPrice = async (req, res) => {
  try {
    const { rideId, amount } = req.body;
    const ride = await rideService.submitPriceProposal(rideId, req.user._id, amount);
    const io = req.app.get('socketio');

    // 📡 EMIT: Au Rider (Proposition reçue)
    io.to(ride.rider.toString()).emit('price_proposal_received', {
      amount: ride.proposedPrice,
      driverName: req.user.name,
      message: `${req.user.name} propose ${amount} FCFA`
    });

    return successResponse(res, { status: 'negotiating' }, 'Proposition envoyée.');
  } catch (error) { return errorResponse(res, error.message, error.statusCode || 500); }
};

// 4. DÉCISION RIDER (Accept / Refuse)
const finalizeRide = async (req, res) => {
  try {
    const { rideId, decision } = req.body;
    const result = await rideService.finalizeProposal(rideId, req.user._id, decision);
    const io = req.app.get('socketio');

    if (result.status === 'ACCEPTED') {
      // ✅ CAS ACCEPTÉ
      await result.ride.populate('driver', 'name phone vehicle currentLocation');
      const driver = result.ride.driver;

      // 📡 EMIT: Au Driver (C'est bon !)
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
      }, 'Course confirmée !');

    } else {
      // ♻️ CAS REFUSÉ (Soft Reject)
      
      // 📡 EMIT: Au Driver rejeté
      io.to(result.rejectedDriverId.toString()).emit('proposal_rejected', {
        message: "Prix refusé. Retour à la recherche."
      });

      // 📡 RE-DISPATCH: Trouver 5 NOUVEAUX chauffeurs
      const newDrivers = await User.find({
        role: 'driver',
        isAvailable: true,
        isBanned: false,
        _id: { $nin: result.ride.rejectedDrivers },
        currentLocation: {
          $near: {
            $geometry: { type: 'Point', coordinates: result.ride.origin.coordinates },
            $maxDistance: 5000
          }
        }
      }).limit(5);

      // 📡 EMIT: Aux Nouveaux
      newDrivers.forEach(driver => {
        io.to(driver._id.toString()).emit('new_ride_request', {
          rideId: result.ride._id,
          origin: result.ride.origin.address,
          destination: result.ride.destination.address,
          distance: result.ride.distance,
          message: "Nouvelle course disponible !"
        });
      });

      return successResponse(res, { status: 'searching' }, 'Recherche relancée...');
    }
  } catch (error) { return errorResponse(res, error.message, error.statusCode || 500); }
};

// 5. START & COMPLETE
const startRide = async (req, res) => {
  try {
    const { rideId } = req.body;
    const ride = await rideService.startRideSession(req.user._id, rideId);
    
    // 📡 EMIT: Au Rider
    req.app.get('socketio').to(ride.rider.toString()).emit('ride_started', { rideId: ride._id, startedAt: ride.startedAt });
    
    return successResponse(res, { status: 'ongoing' }, 'Course démarrée.');
  } catch (error) { return errorResponse(res, error.message, error.statusCode || 500); }
};

const completeRide = async (req, res) => {
  try {
    const { rideId } = req.body;
    const ride = await rideService.completeRideSession(req.user._id, rideId);
    
    // 📡 EMIT: Au Rider
    req.app.get('socketio').to(ride.rider.toString()).emit('ride_completed', { rideId: ride._id, finalPrice: ride.price });
    
    return successResponse(res, { status: 'completed', finalPrice: ride.price }, 'Course terminée.');
  } catch (error) { return errorResponse(res, error.message, error.statusCode || 500); }
};

module.exports = { requestRide, lockRide, submitPrice, finalizeRide, startRide, completeRide };