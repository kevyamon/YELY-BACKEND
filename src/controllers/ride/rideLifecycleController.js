// src/controllers/ride/rideLifecycleController.js
// SOUS-CONTROLEUR - Cycle de vie : Estimation, Demande, Annulation, Negociation
// STANDARD: Industriel / Bank Grade

const rideService = require('../../services/ride/rideLifecycleService'); 
const poiController = require('../poiController'); 
const notificationService = require('../../services/notificationService'); 
const AppError = require('../../utils/AppError');
const logger = require('../../config/logger');
const { successResponse } = require('../../utils/responseHandler');
const User = require('../../models/User'); 
const Ride = require('../../models/Ride');

const estimateRide = async (req, res, next) => {
  try {
    const { pickupLat, pickupLng, dropoffLat, dropoffLng } = req.query;
    
    if (!pickupLat || !pickupLng || !dropoffLat || !dropoffLng) {
      throw new AppError('Coordonnees GPS manquantes pour l\'estimation', 400);
    }

    const origin = [parseFloat(pickupLng), parseFloat(pickupLat)];
    const destination = [parseFloat(dropoffLng), parseFloat(dropoffLat)];
    
    if (origin.some(isNaN) || destination.some(isNaN)) {
      throw new AppError('Format de coordonnees GPS invalide', 400);
    }

    const distance = await rideService.getRouteDistance(origin, destination);
    
    const vehicles = [
      { id: '1', type: 'echo', name: 'Echo', duration: Math.max(1, Math.ceil(distance * 3)) },
      { id: '2', type: 'standard', name: 'Standard', duration: Math.max(1, Math.ceil(distance * 2)) },
      { id: '3', type: 'vip', name: 'VIP', duration: Math.max(1, Math.ceil(distance * 1.5)) }
    ];

    return successResponse(res, { distance, vehicles }, 'Estimation reussie');
  } catch (error) {
    return next(error);
  }
};

const requestRide = async (req, res, next) => {
  try {
    const redisClient = req.app.get('redis');
    const io = req.app.get('socketio');
    
    const { ride, drivers } = await rideService.createRideRequest(req.user._id, req.body, redisClient);

    logger.info(`[DISPATCH] Course ${ride._id} creee (${ride.passengersCount} passagers). ${drivers.length} chauffeurs cibles.`);

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
    const reason = req.body.reason || `Annule par le ${req.user.role}`;
    
    if (!rideId) {
      throw new AppError('L\'identifiant de la course est manquant.', 400);
    }

    const ride = await rideService.cancelRideAction(rideId, req.user._id, req.user.role, reason);
    const io = req.app.get('socketio');

    if (req.user.role === 'rider' && ride.driver) {
       io.to(ride.driver.toString()).emit('ride_cancelled', { rideId });
       notificationService.sendNotification(
         ride.driver, "Course annulée", "Le passager a annulé la demande.", "RIDE_CANCELLED", { rideId: rideId.toString() }
       ).catch(() => {});
    } else if (req.user.role === 'driver') {
       io.to(ride.rider.toString()).emit('ride_cancelled', { rideId });
       notificationService.sendNotification(
         ride.rider, "Course annulée", "Le chauffeur a dû annuler la course.", "RIDE_CANCELLED", { rideId: rideId.toString() }
       ).catch(() => {});
    }

    // --- ENVOI DES NOTIFICATIONS PUSH ET SOCKETS COUPLES DE L'ORDRE ---
    if (ride.type === 'DELIVERY' && ride.orderId) {
      const Order = require('../../models/Order');
      Order.findById(ride.orderId).populate('customer seller driver')
        .then(order => {
          if (order) {
            io.to(order.customer._id.toString()).emit('order_updated', order);
            io.to(order.seller._id.toString()).emit('order_updated', order);
            
            if (req.user.role === 'rider' || req.user.role === 'seller') {
              // Annulation par le client
              notificationService.sendNotification(
                order.seller._id,
                "Commande annulée ⚠️",
                `Le client a annulé sa commande #${order._id.toString().slice(-6)} et sa livraison.`,
                "ORDER_CANCELLED",
                { orderId: order._id.toString() }
              ).catch(() => {});
            } else if (req.user.role === 'driver') {
              // Annulation par le chauffeur (Relance automatique du dispatch en cours)
              notificationService.sendNotification(
                order.customer._id,
                "Recherche de livreur relancée 🔄",
                `Votre livreur s'est désisté. Nous recherchons activement un autre livreur pour votre commande.`,
                "ORDER_UPDATE",
                { orderId: order._id.toString() }
              ).catch(() => {});
              
              notificationService.sendNotification(
                order.seller._id,
                "Recherche de livreur relancée 🔄",
                `Le livreur s'est désisté de la commande #${order._id.toString().slice(-6)}. La recherche d'un nouveau livreur a été relancée automatiquement.`,
                "ORDER_UPDATE",
                { orderId: order._id.toString() }
              ).catch(() => {});
            }
          }
        }).catch(err => logger.error(`[SOCKET ERROR] CancelRide Order find failed: ${err.message}`));
    }

    if (ride.origin?.address) {
      await poiController.releasePendingPOI(ride.origin.address, io);
    }
    if (ride.destination?.address) {
      await poiController.releasePendingPOI(ride.destination.address, io);
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
        notificationService.sendNotification(
          driverId, "Course annulée", "La course a été annulée (Nettoyage système).", "RIDE_CANCELLED", {}
        ).catch(() => {});
      });
    }

    if (result.cancelledRides && result.cancelledRides.length > 0) {
      for (const ride of result.cancelledRides) {
        if (ride.origin?.address) {
          await poiController.releasePendingPOI(ride.origin.address, io);
        }
        if (ride.destination?.address) {
          await poiController.releasePendingPOI(ride.destination.address, io);
        }
      }
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
 
    notificationService.sendNotification(
      ride.rider, "Chauffeur trouvé", `${req.user.name} est intéressé par votre course et prépare son tarif.`, "DRIVER_FOUND", { rideId: ride._id.toString() }
    ).catch(() => {});
 
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
      throw new AppError('Donnees incompletes pour soumettre un prix.', 400);
    }

    const ride = await rideService.submitPriceProposal(rideId, req.user._id, amount);
    const io = req.app.get('socketio');

    io.to(ride.rider.toString()).emit('price_proposal_received', {
      amount: ride.proposedPrice,
      driverName: req.user.name,
      driverProfilePicture: req.user.profilePicture 
    });

    notificationService.sendNotification(
      ride.rider, "Proposition de prix", `${req.user.name} vous propose ${amount} FCFA.`, "PRICE_PROPOSAL", { rideId: ride._id.toString() }
    ).catch(() => {});

    return successResponse(res, { status: 'negotiating' }, 'Proposition transmise');
  } catch (error) {
    return next(error);
  }
};

const finalizeRide = async (req, res, next) => {
  try {
    const { rideId, decision } = req.body;
    
    if (!rideId || !decision) {
      throw new AppError('Donnees incompletes pour finaliser.', 400);
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

      notificationService.sendNotification(
        driver._id, "Course acceptée", "Le passager a validé votre prix. En route !", "PROPOSAL_ACCEPTED", { rideId: result.ride._id.toString() }
      ).catch(() => {});

      // --- EMETTRE LES EVENTS TEMPS REEL DE L'ORDRE ---
      if (result.ride.type === 'DELIVERY' && result.ride.orderId) {
        const Order = require('../../models/Order');
        Order.findById(result.ride.orderId).populate('customer seller driver')
          .then(order => {
            if (order) {
              io.to(order.customer._id.toString()).emit('order_updated', order);
              io.to(order.seller._id.toString()).emit('order_updated', order);
              
              notificationService.sendNotification(
                order.seller._id, 
                "Livreur attribué 🚴", 
                `Le livreur ${driver.name} a accepté la livraison de la commande #${order._id.toString().slice(-6)}. Il arrive pour récupérer le colis.`, 
                "ORDER_UPDATE", 
                { orderId: order._id.toString() }
              ).catch(() => {});
            }
          }).catch(err => logger.error(`[SOCKET ERROR] FinalizeRide Order find failed: ${err.message}`));
      }

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

      notificationService.sendNotification(
        result.rejectedDriverId, "Proposition refusée", "Le passager a décliné votre tarif.", "PROPOSAL_REJECTED", { rideId: result.ride._id.toString() }
      ).catch(() => {});

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

    if (req.user.role === 'rider' || req.user.role === 'seller') {
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
      searchRadius: currentRide.currentSearchRadius, 
      riderName: currentRide.rider?.name,
      riderPhone: currentRide.rider?.phone,
      riderProfilePicture: currentRide.rider?.profilePicture,
      driverName: currentRide.driver?.name,
      driverPhone: currentRide.driver?.phone,
      driverProfilePicture: currentRide.driver?.profilePicture,
      driverLocation: currentRide.driver?.currentLocation,
    };

    return successResponse(res, formattedRide, 'Course en cours recuperee');
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