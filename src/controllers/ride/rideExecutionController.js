// src/controllers/ride/rideExecutionController.js
// SOUS-CONTROLEUR - Execution : Arrivee, Demarrage, Cloture, Notation
// CSCSM Level: Bank Grade

const rideService = require('../../services/rideService');
const User = require('../../models/User');
const AppError = require('../../utils/AppError');
const logger = require('../../config/logger');
const { successResponse } = require('../../utils/responseHandler');

const markAsArrived = async (req, res, next) => {
  try {
    const { rideId } = req.body;
    
    if (!rideId) {
      throw new AppError('L\'identifiant de la course est manquant.', 400);
    }

    const ride = await rideService.markRideAsArrived(req.user._id, rideId);
    
    req.app.get('socketio').to(ride.rider.toString()).emit('ride_arrived', { 
      rideId: ride._id, 
      arrivedAt: ride.arrivedAt 
    });
    
    logger.info(`[RIDE EXECUTION] Course ${rideId} - Chauffeur sur place (Statut: arrived). Driver ID: ${req.user._id}`);
    
    return successResponse(res, { status: 'arrived' }, 'Chauffeur sur place');
  } catch (error) {
    return next(error);
  }
};

const startRide = async (req, res, next) => {
  try {
    const { rideId } = req.body;
    
    if (!rideId) {
      throw new AppError('L\'identifiant de la course est manquant.', 400);
    }

    const ride = await rideService.startRideSession(req.user._id, rideId);
    
    req.app.get('socketio').to(ride.rider.toString()).emit('ride_started', { 
      rideId: ride._id, 
      startedAt: ride.startedAt 
    });
    
    logger.info(`[RIDE EXECUTION] Course ${rideId} démarrée (Statut: in_progress). Driver ID: ${req.user._id}`);
    
    return successResponse(res, { status: 'in_progress' }, 'En route');
  } catch (error) {
    return next(error);
  }
};

const completeRide = async (req, res, next) => {
  try {
    const { rideId } = req.body;
    
    if (!rideId) {
      throw new AppError('L\'identifiant de la course est manquant.', 400);
    }

    // MODIFICATION : Récupération de l'instance socketio et injection dans le service
    const io = req.app.get('socketio');
    const ride = await rideService.completeRideSession(req.user._id, rideId, io);
    
    const updatedDriver = await User.findById(req.user._id).select('totalRides totalEarnings rating');

    io.to(ride.rider.toString()).emit('ride_completed', { 
      rideId: ride._id, 
      finalPrice: ride.price 
    });

    io.to(req.user._id.toString()).emit('ride_completed', { 
      rideId: ride._id, 
      finalPrice: ride.price 
    });
    
    logger.info(`[RIDE EXECUTION] Course ${rideId} terminée. Driver ID: ${req.user._id}. Prix final: ${ride.price}`);
    
    return successResponse(res, { 
      status: 'completed', 
      finalPrice: ride.price,
      stats: {
        totalRides: updatedDriver.totalRides,
        totalEarnings: updatedDriver.totalEarnings,
        rating: updatedDriver.rating
      }
    }, 'Course achevée');
  } catch (error) {
    return next(error);
  }
};

const rateRide = async (req, res, next) => {
  try {
    const rideId = req.params.id;
    const { rating, comment } = req.body;
    
    if (!rideId) throw new AppError('L\'identifiant de la course est manquant.', 400);
    if (!rating || rating < 1 || rating > 5) throw new AppError('La note doit être comprise entre 1 et 5.', 400);

    await rideService.submitRideRating(rideId, rating, comment);

    return successResponse(res, { status: 'rated' }, 'Note enregistrée avec succès');
  } catch (error) {
    return next(error);
  }
};

const getRideHistory = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    
    const result = await rideService.getRideHistory(req.user, page, limit);
    
    return successResponse(res, result, 'Historique récupéré');
  } catch (error) {
    return next(error);
  }
};

const hideFromHistory = async (req, res, next) => {
  try {
    const { id } = req.params;
    await rideService.hideRideFromHistory(req.user, id);
    return successResponse(res, null, 'Course supprimée de votre historique.');
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  markAsArrived,
  startRide,
  completeRide,
  rateRide,
  getRideHistory,
  hideFromHistory
};