// src/controllers/ride/rideLifecycleController.js
// SOUS-CONTROLEUR RIDE - Cycle de vie des requêtes (Requête, Annulation, Urgence)
// STANDARD: Industriel / Bank Grade

const rideService = require('../../services/ride/rideLifecycleService'); 
const poiController = require('../poiController'); 
const notificationService = require('../../services/notificationService'); 
const AppError = require('../../utils/AppError');
const logger = require('../../config/logger');
const { successResponse } = require('../../utils/responseHandler');
const User = require('../../models/User');

const { estimateRide, getCurrentRide, getRideById } = require('./rideQueryController');
const { lockRide, submitPrice, finalizeRide } = require('./rideNegotiationController');

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
    const reason = req.body.reason || `Annulé par le ${req.user.role}`;
    
    if (!rideId) {
      throw new AppError('L\'identifiant de la course est manquant.', 400);
    }

    const io = req.app.get('socketio');
    const ride = await rideService.cancelRideAction(rideId, req.user._id, req.user.role, reason, io);

    if (req.user.role === 'rider') {
       const targetDrivers = ride.notifiedDrivers || [];
       if (ride.driver && !targetDrivers.includes(ride.driver.toString())) {
         targetDrivers.push(ride.driver);
       }
       targetDrivers.forEach(driverId => {
         io.to(driverId.toString()).emit('ride_cancelled', { rideId, reason: 'Course annulée par le client' });
       });
       if (ride.driver) {
         notificationService.sendNotification(
           ride.driver, "Course annulée", "Le passager a annulé la demande.", "RIDE_CANCELLED", { rideId: rideId.toString() }
         ).catch(() => {});
       }
    } else if (req.user.role === 'driver') {
       io.to(ride.rider.toString()).emit('ride_cancelled', { rideId });
       notificationService.sendNotification(
         ride.rider, "Course annulée", "Le chauffeur a dû annuler la course.", "RIDE_CANCELLED", { rideId: rideId.toString() }
       ).catch(() => {});
    }

    if (ride.type === 'DELIVERY' && ride.orderId) {
      const Order = require('../../models/Order');
      Order.findById(ride.orderId).populate('customer seller driver')
        .then(order => {
          if (order) {
            io.to(order.customer._id.toString()).emit('order_updated', order);
            io.to(order.seller._id.toString()).emit('order_updated', order);
            
            if (req.user.role === 'rider' || req.user.role === 'seller') {
              notificationService.sendNotification(
                order.seller._id,
                "Commande annulée",
                `Le client a annulé sa commande #${order._id.toString().slice(-6)} et sa livraison.`,
                "ORDER_CANCELLED",
                { orderId: order._id.toString() }
              ).catch(() => {});
            } else if (req.user.role === 'driver') {
              notificationService.sendNotification(
                order.customer._id,
                "Recherche de livreur relancée",
                `Votre livreur s'est désisté. Nous recherchons activement un autre livreur pour votre commande.`,
                "ORDER_UPDATE",
                { orderId: order._id.toString() }
              ).catch(() => {});
              
              notificationService.sendNotification(
                order.seller._id,
                "Recherche de livreur relancée",
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

module.exports = {
  requestRide,
  cancelRide,
  emergencyCancel,
  estimateRide,
  getCurrentRide,
  getRideById,
  lockRide,
  submitPrice,
  finalizeRide
};