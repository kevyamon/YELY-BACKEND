// src/services/ride/rideNegotiationService.js
// SERVICE METIER - Negociations de tarifs en temps reel
// STANDARD: Industriel / Bank Grade

const mongoose = require('mongoose');
const Ride = require('../../models/Ride');
const User = require('../../models/User');
const notificationService = require('../notificationService');
const AppError = require('../../utils/AppError');
const logger = require('../../config/logger');

const lockRideForNegotiation = async (rideId, driverId) => {
  const ride = await Ride.findOneAndUpdate(
    { _id: rideId, status: 'searching' },
    { 
      $set: { 
        status: 'accepted', 
        driver: driverId, 
        acceptedAt: new Date() 
      } 
    },
    { new: true }
  );

  if (!ride) throw new AppError('Course indisponible ou deja prise.', 409);

  const userRepository = require('../../repositories/userRepository');
  await userRepository.updateDriverAvailability(driverId, false);

  if (ride.type === 'DELIVERY' && ride.orderId) {
    const Order = require('../../models/Order');
    await Order.findByIdAndUpdate(ride.orderId, { driver: driverId });
  }

  return ride;
};

const submitPriceProposal = async (rideId, driverId, selectedAmount) => {
  const ride = await Ride.findById(rideId);
  if (!ride) throw new AppError('Session introuvable.', 404);

  if (ride.type === 'DELIVERY') {
    if (ride.status !== 'searching') {
      throw new AppError('Cette livraison a déjà été acceptée par un autre livreur.', 400);
    }

    const isValidOption = ride.priceOptions.some(opt => opt.amount === selectedAmount);
    if (!isValidOption) throw new AppError('Montant non autorisé.', 400);

    ride.driver = driverId;
    ride.status = 'accepted';
    ride.proposedPrice = selectedAmount;
    ride.price = selectedAmount;
    ride.acceptedAt = new Date();
    await ride.save();

    const userRepository = require('../../repositories/userRepository');
    await userRepository.updateDriverAvailability(driverId, false);

    if (ride.orderId) {
      const Order = require('../../models/Order');
      await Order.findByIdAndUpdate(ride.orderId, { driver: driverId });
    }

    return ride;
  }

  if (ride.driver?.toString() !== driverId.toString() || ride.status !== 'negotiating') {
    throw new AppError('Session invalide.', 404);
  }

  const isValidOption = ride.priceOptions.some(opt => opt.amount === selectedAmount);
  if (!isValidOption) throw new AppError('Montant non autorisé.', 400);

  ride.proposedPrice = selectedAmount;
  await ride.save();
  return ride;
};

const releaseStuckNegotiations = async (io, rideId) => {
  const ride = await Ride.findOne({ _id: rideId, status: 'negotiating' });
  if (ride) {
    const rejectedDriverId = ride.driver;
    ride.status = 'searching';
    ride.driver = null;
    ride.proposedPrice = null;
    ride.negotiationStartedAt = null;
    ride.rejectedDrivers.push(rejectedDriverId);
    await ride.save();
    
    io.to(rejectedDriverId.toString()).emit('ride_taken_by_other', { rideId });

    notificationService.sendNotification(
      rejectedDriverId, "Délai expiré", "Le passager n'a pas répondu à temps, la course a été relancée.", "NEGOTIATION_TIMEOUT", { rideId: ride._id.toString() }
    ).catch(() => {});

    const { cleanupQueue } = require('./rideDispatchService');
    await cleanupQueue.add(
      'expand-search',
      { rideId: ride._id },
      { delay: 0, removeOnComplete: true }
    );
  }
};

const finalizeProposal = async (rideId, riderId, decision) => {
  const session = await mongoose.startSession();
  let result;

  try {
    await session.withTransaction(async () => {
      const ride = await Ride.findOne({ _id: rideId, rider: riderId, status: 'negotiating' }).session(session);
      if (!ride) throw new AppError('Session invalide.', 404);

      if (decision === 'ACCEPTED') {
        if (!ride.proposedPrice) {
          throw new AppError('Le chauffeur n\'a pas encore soumis de proposition de prix.', 400);
        }
        ride.status = 'accepted';
        ride.price = ride.proposedPrice;
        ride.acceptedAt = new Date();
        await ride.save({ session });
        
        const userRepository = require('../../repositories/userRepository');
        await userRepository.updateDriverAvailability(ride.driver, false, session);
        
        if (ride.type === 'DELIVERY' && ride.orderId) {
          const Order = require('../../models/Order');
          const order = await Order.findById(ride.orderId).session(session);
          if (order) {
            order.driver = ride.driver;
            order.status = 'searching'; 
            order.history.push({ status: 'searching', comment: 'Livreur attribué', timestamp: Date.now() });
            await order.save({ session });
          }
        }
        
        result = { status: 'ACCEPTED', ride };
      } else {
        const rejectedDriverId = ride.driver;
        ride.status = 'searching';
        ride.driver = null;
        ride.proposedPrice = null;
        ride.negotiationStartedAt = null;
        ride.rejectedDrivers.push(rejectedDriverId);
        
        await ride.save({ session });
        result = { status: 'SEARCHING_AGAIN', ride, rejectedDriverId };
      }
    });
  } finally {
    await session.endSession();
  }
  
  if (result.status === 'SEARCHING_AGAIN') {
    const { cleanupQueue } = require('./rideDispatchService');
    await cleanupQueue.add(
      'expand-search',
      { rideId },
      { delay: 0, removeOnComplete: true }
    );
  }

  return result;
};

module.exports = {
  lockRideForNegotiation,
  submitPriceProposal,
  releaseStuckNegotiations,
  finalizeProposal
};
