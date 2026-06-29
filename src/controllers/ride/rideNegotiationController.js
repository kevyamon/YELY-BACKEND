// src/controllers/ride/rideNegotiationController.js
// SOUS-CONTROLEUR RIDE - Négociations et Tarifications
// STANDARD: Industriel / Bank Grade

const rideService = require('../../services/ride/rideLifecycleService'); 
const notificationService = require('../../services/notificationService'); 
const AppError = require('../../utils/AppError');
const logger = require('../../config/logger');
const { successResponse } = require('../../utils/responseHandler');
const User = require('../../models/User');

const lockRide = async (req, res, next) => {
  try {
    const { rideId } = req.body;
    
    if (!rideId) {
      throw new AppError('L\'identifiant de la course est manquant.', 400);
    }
 
    const ride = await rideService.lockRideForNegotiation(rideId, req.user._id);
    const io = req.app.get('socketio');
 
    // Fermer les modales des autres chauffeurs notifiés (Anti-doublons de commandes)
    const otherNotifiedDrivers = (ride.notifiedDrivers || []).filter(id => id.toString() !== req.user._id.toString());
    otherNotifiedDrivers.forEach(driverId => {
      io.to(driverId.toString()).emit('ride_taken_by_other', { rideId: ride._id });
    });
 
    // Récupérer le profil du passager pour le chauffeur
    const riderUser = await User.findById(ride.rider).select('name phone profilePicture');

    // Événement socket pour le passager (Rider)
    const riderPayload = {
      rideId: ride._id,
      status: 'accepted',
      driverName: req.user.name,
      driverPhone: req.user.phone,
      driverProfilePicture: req.user.profilePicture,
      driverLocation: req.user.currentLocation,
      vehicle: req.user.vehicle,
      price: ride.price,
      proposedPrice: ride.proposedPrice,
      origin: ride.origin,
      destination: ride.destination,
      forfait: ride.forfait,
      passengersCount: ride.passengersCount
    };
    io.to(ride.rider.toString()).emit('proposal_accepted', riderPayload);
 
    // Événement socket pour le chauffeur (Driver)
    const driverPayload = {
      rideId: ride._id,
      status: 'accepted',
      riderName: riderUser?.name || 'Passager',
      riderPhone: riderUser?.phone,
      riderProfilePicture: riderUser?.profilePicture,
      origin: ride.origin,
      destination: ride.destination,
      price: ride.price,
      proposedPrice: ride.proposedPrice,
      forfait: ride.forfait,
      passengersCount: ride.passengersCount
    };
    io.to(req.user._id.toString()).emit('proposal_accepted', driverPayload);

    // Notification Push pour le passager
    notificationService.sendNotification(
      ride.rider, 
      "Course confirmée", 
      `Le chauffeur ${req.user.name} a accepté votre course pour ${ride.price} FCFA. En route !`, 
      "PROPOSAL_ACCEPTED", 
      { rideId: ride._id.toString() }
    ).catch(() => {});
 
    return successResponse(res, { 
      rideId: ride._id, 
      status: ride.status, 
      priceOptions: ride.priceOptions 
    }, 'Course acceptée avec succès.');
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

    if (ride.type === 'DELIVERY') {
      const rider = await User.findById(ride.rider).select('name phone profilePicture');
      
      // Fermer les modales des autres chauffeurs notifiés pour cette livraison
      const otherNotifiedDrivers = (ride.notifiedDrivers || []).filter(id => id.toString() !== req.user._id.toString());
      otherNotifiedDrivers.forEach(driverId => {
        io.to(driverId.toString()).emit('ride_taken_by_other', { rideId: ride._id });
      });
      
      io.to(req.user._id.toString()).emit('proposal_accepted', {
        rideId: ride._id,
        riderName: rider?.name || 'Client',
        riderPhone: rider?.phone,
        riderProfilePicture: rider?.profilePicture, 
        origin: ride.origin,
        destination: ride.destination,
        collectionPoints: ride.collectionPoints,
        type: 'DELIVERY'
      });

      io.to(ride.rider.toString()).emit('ride_accepted', {
        rideId: ride._id,
        driver: {
          name: req.user.name,
          phone: req.user.phone,
          vehicle: req.user.vehicle,
          location: req.user.currentLocation,
          profilePicture: req.user.profilePicture
        }
      });

      if (ride.orderId) {
        const Order = require('../../models/Order');
        Order.findById(ride.orderId).populate('customer seller driver')
          .then(order => {
            if (order) {
              io.to(order.customer._id.toString()).emit('order_updated', order);
              io.to(order.seller._id.toString()).emit('order_updated', order);
              
              notificationService.sendNotification(
                order.seller._id, 
                "Livreur attribué", 
                `Le livreur ${req.user.name} a accepté la livraison de la commande #${order._id.toString().slice(-6)}. Il arrive pour récupérer le colis.`, 
                "ORDER_UPDATE", 
                { orderId: order._id.toString() }
              ).catch(() => {});

              notificationService.sendNotification(
                order.customer._id, 
                "Livreur en route", 
                `Le livreur ${req.user.name} a été attribué à votre commande et est en route.`, 
                "ORDER_UPDATE", 
                { orderId: order._id.toString() }
              ).catch(() => {});
            }
          });
      }

      return successResponse(res, { 
        status: 'accepted',
        driver: {
          name: req.user.name,
          phone: req.user.phone,
          vehicle: req.user.vehicle,
          location: req.user.currentLocation,
          profilePicture: req.user.profilePicture
        }
      }, 'Livraison acceptée');
    }

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

      if (result.ride.type === 'DELIVERY' && result.ride.orderId) {
        const Order = require('../../models/Order');
        Order.findById(result.ride.orderId).populate('customer seller driver')
          .then(order => {
            if (order) {
              io.to(order.customer._id.toString()).emit('order_updated', order);
              io.to(order.seller._id.toString()).emit('order_updated', order);
              
              notificationService.sendNotification(
                order.seller._id, 
                "Livreur attribué", 
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

module.exports = {
  lockRide,
  submitPrice,
  finalizeRide
};
