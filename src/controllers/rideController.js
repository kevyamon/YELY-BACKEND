// src/controllers/rideController.js
// CONTRÔLEUR COURSES - Orchestration Négociation & Sockets
// CSCSM Level: Bank Grade

const rideService = require('../services/rideService');
const User = require('../models/User'); // Nécessaire pour le re-dispatch
const { successResponse, errorResponse } = require('../utils/responseHandler');

/**
 * @desc 1. Demander une course (Broadcast aux 5 chauffeurs)
 */
const requestRide = async (req, res) => {
  try {
    const { ride, drivers } = await rideService.createRideRequest(req.user._id, req.body);
    const io = req.app.get('socketio');

    // Notification aux 5 chauffeurs trouvés
    drivers.forEach(driver => {
      io.to(driver._id.toString()).emit('new_ride_request', {
        rideId: ride._id,
        origin: ride.origin.address,
        destination: ride.destination.address,
        distance: ride.distance,
        // On n'envoie PAS ENCORE le prix. Juste le trajet.
        message: "Nouvelle course disponible !"
      });
    });

    return successResponse(res, { 
      rideId: ride._id, 
      status: ride.status 
    }, 'Recherche en cours...', 201);
  } catch (error) {
    return errorResponse(res, error.message, error.statusCode || 500);
  }
};

/**
 * @desc 2. Driver clique "Prendre" (Lock)
 */
const lockRide = async (req, res) => {
  try {
    const { rideId } = req.body;
    const ride = await rideService.lockRideForNegotiation(rideId, req.user._id);
    const io = req.app.get('socketio');

    // 1. Notifier le Rider : "Un chauffeur a pris la course, attente prix"
    io.to(ride.rider.toString()).emit('driver_found', {
      message: "Un chauffeur a pris la course. Attente de sa proposition...",
      driverName: req.user.name,
      vehicle: req.user.vehicle
    });

    // 2. Notifier les AUTRES chauffeurs : "Trop tard !"
    // On envoie un broadcast global aux drivers, le front filtrera par ID
    io.to('drivers').emit('ride_taken_by_other', { rideId });

    // 3. Répondre au Driver avec les 3 options de prix pour sa modale
    return successResponse(res, {
      rideId: ride._id,
      status: ride.status,
      priceOptions: ride.priceOptions // C'est ici qu'il voit les 3 boutons
    }, 'Course verrouillée. Choisissez votre prix.');

  } catch (error) {
    return errorResponse(res, error.message, error.statusCode || 500);
  }
};

/**
 * @desc 3. Driver choisit son prix (Propose)
 */
const submitPrice = async (req, res) => {
  try {
    const { rideId, amount } = req.body;
    const ride = await rideService.submitPriceProposal(rideId, req.user._id, amount);
    const io = req.app.get('socketio');

    // Notifier le Rider : "Proposition reçue, Accepter/Refuser ?"
    io.to(ride.rider.toString()).emit('price_proposal_received', {
      amount: ride.proposedPrice,
      driverName: req.user.name,
      rating: 4.8 // Exemple (à récupérer du user)
    });

    return successResponse(res, { status: 'negotiating' }, 'Proposition envoyée au client.');

  } catch (error) {
    return errorResponse(res, error.message, error.statusCode || 500);
  }
};

/**
 * @desc 4. Rider décide (Finalize)
 */
const finalizeRide = async (req, res) => {
  try {
    const { rideId, decision } = req.body;
    const result = await rideService.finalizeProposal(rideId, req.user._id, decision);
    const io = req.app.get('socketio');

    if (result.status === 'ACCEPTED') {
      // CAS A : SUCCÈS 🎉
      // Populate driver info
      await result.ride.populate('driver', 'name phone vehicle currentLocation');
      const driver = result.ride.driver;

      // Notifier Driver : "C'est validé, go !"
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
      // CAS B : REFUS (SOFT REJECT) ♻️
      // 1. Notifier le chauffeur rejeté
      io.to(result.rejectedDriverId.toString()).emit('proposal_rejected', {
        message: "Le client a refusé votre prix. Retour à la recherche."
      });

      // 2. RETROUVER DE NOUVEAUX CHAUFFEURS (Re-Dispatch)
      // On cherche 5 chauffeurs autour du point de départ, SAUF ceux déjà rejetés
      const newDrivers = await User.find({
        role: 'driver',
        isAvailable: true,
        isBanned: false,
        _id: { $nin: result.ride.rejectedDrivers }, // Exclusion critique
        currentLocation: {
          $near: {
            $geometry: { type: 'Point', coordinates: result.ride.origin.coordinates },
            $maxDistance: 5000
          }
        }
      }).limit(5);

      // 3. Notifier ces nouveaux chauffeurs
      newDrivers.forEach(driver => {
        io.to(driver._id.toString()).emit('new_ride_request', {
          rideId: result.ride._id,
          origin: result.ride.origin.address,
          destination: result.ride.destination.address,
          distance: result.ride.distance,
          message: "Nouvelle course disponible !"
        });
      });

      return successResponse(res, { status: 'searching' }, 'Recherche de nouveaux chauffeurs...');
    }

  } catch (error) {
    return errorResponse(res, error.message, error.statusCode || 500);
  }
};

const startRide = async (req, res) => {
  try {
    const { rideId } = req.body;
    const ride = await rideService.startRideSession(req.user._id, rideId);
    req.app.get('socketio').to(ride.rider.toString()).emit('ride_started', { rideId: ride._id, startedAt: ride.startedAt });
    return successResponse(res, { status: 'ongoing' }, 'Course démarrée.');
  } catch (error) { return errorResponse(res, error.message, error.statusCode || 500); }
};

const completeRide = async (req, res) => {
  try {
    const { rideId } = req.body;
    const ride = await rideService.completeRideSession(req.user._id, rideId);
    req.app.get('socketio').to(ride.rider.toString()).emit('ride_completed', { rideId: ride._id, finalPrice: ride.price });
    return successResponse(res, { status: 'completed', finalPrice: ride.price }, 'Course terminée.');
  } catch (error) { return errorResponse(res, error.message, error.statusCode || 500); }
};

module.exports = { requestRide, lockRide, submitPrice, finalizeRide, startRide, completeRide };