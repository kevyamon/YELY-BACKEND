// src/controllers/ride/rideQueryController.js
// SOUS-CONTROLEUR RIDE - Estimations, état en cours et requêtes
// STANDARD: Industriel / Bank Grade

const rideService = require('../../services/ride/rideLifecycleService'); 
const AppError = require('../../utils/AppError');
const { successResponse } = require('../../utils/responseHandler');
const Ride = require('../../models/Ride');

const pricingService = require('../../services/pricingService');

const estimateRide = async (req, res, next) => {
  try {
    let { pickupLat, pickupLng, dropoffLat, dropoffLng, passengersCount, weather } = req.query;
    
    if (!pickupLat || !pickupLng || !dropoffLat || !dropoffLng) {
      throw new AppError('Coordonnees GPS manquantes pour l\'estimation', 400);
    }

    if (typeof pickupLat === 'string') pickupLat = pickupLat.replace(',', '.');
    if (typeof pickupLng === 'string') pickupLng = pickupLng.replace(',', '.');
    if (typeof dropoffLat === 'string') dropoffLat = dropoffLat.replace(',', '.');
    if (typeof dropoffLng === 'string') dropoffLng = dropoffLng.replace(',', '.');

    const origin = [parseFloat(pickupLng), parseFloat(pickupLat)];
    const destination = [parseFloat(dropoffLng), parseFloat(dropoffLat)];
    
    if (origin.some(isNaN) || destination.some(isNaN)) {
      throw new AppError('Format de coordonnees GPS invalide', 400);
    }

    const distance = await rideService.getRouteDistance(origin, destination);
    
    // Calcul des prix dynamiques et plafonnés
    const pricingResult = await pricingService.generatePriceOptions(
      origin, 
      destination, 
      distance, 
      passengersCount || 1, 
      false, 
      weather || 'sunny'
    );

    const ecoPrice = pricingResult.options.find(o => o.label === 'ECO')?.amount || 200;
    const vipPrice = pricingResult.options.find(o => o.label === 'VIP')?.amount || 700;

    const vehicles = [
      { id: '1', type: 'echo', name: 'Partagé', duration: Math.max(1, Math.ceil(distance * 3)), price: ecoPrice },
      { id: '2', type: 'vip', name: 'Privé (Seul)', duration: Math.max(1, Math.ceil(distance * 1.5)), price: vipPrice }
    ];

    return successResponse(res, { distance, vehicles }, 'Estimation reussie');
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

const getRideById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const ride = await Ride.findById(id)
      .populate('rider', 'name phone profilePicture')
      .populate('driver', 'name phone vehicle currentLocation profilePicture')
      .lean();

    if (!ride) {
      return successResponse(res, null, 'Course introuvable');
    }

    const formattedRide = {
      ...ride,
      id: ride._id,
      rideId: ride._id,
      searchRadius: ride.currentSearchRadius, 
      riderName: ride.rider?.name,
      riderPhone: ride.rider?.phone,
      riderProfilePicture: ride.rider?.profilePicture,
      driverName: ride.driver?.name,
      driverPhone: ride.driver?.phone,
      driverProfilePicture: ride.driver?.profilePicture,
      driverLocation: ride.driver?.currentLocation,
    };

    return successResponse(res, formattedRide, 'Course récupérée avec succès');
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  estimateRide,
  getCurrentRide,
  getRideById
};
