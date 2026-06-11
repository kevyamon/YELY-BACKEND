// src/services/ride/rideGeofenceService.js
// SERVICE METIER - Geofencing et suivi de la progression GPS de la course
// STANDARD: Industriel / Bank Grade

const Ride = require('../../models/Ride');
const notificationService = require('../notificationService');
const { calculateHaversineDistance } = require('./rideHelpers');
const logger = require('../../config/logger');

const checkRideProgressOnLocationUpdate = async (driverId, coordinates, io) => {
  try {
    const ride = await Ride.findOne({
      driver: driverId,
      status: { $in: ['accepted', 'in_progress'] }
    });

    if (!ride) return;

    if (ride.status === 'accepted') {
      const distToPickup = calculateHaversineDistance(coordinates, ride.origin.coordinates);
      
      if (distToPickup <= 0.015) {
        ride.status = 'arrived';
        ride.arrivedAt = new Date();
        await ride.save();

        io.to(ride.rider.toString()).emit('ride_arrived', { rideId: ride._id, arrivedAt: ride.arrivedAt });
        io.to(driverId.toString()).emit('ride_arrived', { rideId: ride._id, arrivedAt: ride.arrivedAt });
        
        notificationService.sendNotification(
          ride.rider, "Chauffeur sur place", "Votre chauffeur est arrive au point de rendez-vous.", "DRIVER_ARRIVED", { rideId: ride._id.toString() }
        ).catch(() => {});

        logger.info(`[GEOFENCING] Driver ${driverId} arrive chez le client (15m). Statut MAJ vers 'arrived'`);
      }
    }

    if (ride.status === 'in_progress') {
      const distToDropoff = calculateHaversineDistance(coordinates, ride.destination.coordinates);
      
      if (distToDropoff <= 0.02) {
        io.to(driverId.toString()).emit('prompt_arrival_confirm', { rideId: ride._id });
        logger.info(`[GEOFENCING] Course ${ride._id} a 20m de la destination. Modale declenchee.`);
      }
    }
  } catch (error) {
    logger.error(`[GEOFENCING ERROR] Echec de la verif de proximite : ${error.message}`);
  }
};

module.exports = {
  checkRideProgressOnLocationUpdate
};
