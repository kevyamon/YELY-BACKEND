// src/controllers/ride/rideExecutionController.js
// SOUS-CONTROLEUR - Execution : Arrivee, Demarrage, Cloture, Notation
// CSCSM Level: Bank Grade

const rideService = require('../../services/ride/rideExecutionService');
const notificationService = require('../../services/notificationService'); // IMPORT AJOUTE
const User = require('../../models/User');
const Settings = require('../../models/Settings');
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

    // DECLENCHEUR PUSH : Prevenir le client de l'arrivee
    notificationService.sendNotification(
      ride.rider, "Chauffeur sur place", "Votre chauffeur est arrive au point de rendez-vous.", "SYSTEM", { rideId: ride._id.toString() }
    ).catch(() => {});
    
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

    // DECLENCHEUR PUSH : Depart de la course
    notificationService.sendNotification(
      ride.rider, "Course demarree", "Votre course a commence. Bonne route !", "SYSTEM", { rideId: ride._id.toString() }
    ).catch(() => {});
    
    logger.info(`[RIDE EXECUTION] Course ${rideId} demarree (Statut: in_progress). Driver ID: ${req.user._id}`);
    
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

    // DECLENCHEUR PUSH : Fin de course pour le client
    notificationService.sendNotification(
      ride.rider, "Course terminee", "Nous sommes arrives a destination. Merci d'avoir voyage avec Yely !", "SYSTEM", { rideId: ride._id.toString() }
    ).catch(() => {});
    
    logger.info(`[RIDE EXECUTION] Course ${rideId} terminee. Driver ID: ${req.user._id}. Prix final: ${ride.price}`);

    // LE PIEGE DE FIN DE COURSE (Verification d'abonnement post-course)
    try {
      const settings = await Settings.findOne();
      
      if (settings && !settings.isGlobalFreeAccess) {
        const driver = await User.findById(req.user._id).populate('subscription');
        
        if (!driver.subscription || !driver.subscription.isActive) {
          if (io) {
            io.to(driver._id.toString()).emit('FORCE_SUBSCRIPTION_LOCK', {
              message: "Votre periode de grace est terminee. Veuillez activer un Pass Yely pour continuer a recevoir des courses."
            });
            logger.info(`[SUBSCRIPTION LOCK] Chauffeur ${req.user._id} verrouille a la fin de la course.`);
          }
        }
      }
    } catch (lockError) {
      logger.error(`[RIDE SUBSCRIPTION CHECK] Erreur non bloquante: ${lockError.message}`);
    }
    
    return successResponse(res, { 
      status: 'completed', 
      finalPrice: ride.price,
      stats: {
        totalRides: updatedDriver.totalRides,
        totalEarnings: updatedDriver.totalEarnings,
        rating: updatedDriver.rating
      }
    }, 'Course achevee');
  } catch (error) {
    return next(error);
  }
};

const rateRide = async (req, res, next) => {
  try {
    const rideId = req.params.id;
    const { rating, comment } = req.body;
    
    if (!rideId) throw new AppError('L\'identifiant de la course est manquant.', 400);
    if (!rating || rating < 1 || rating > 5) throw new AppError('La note doit etre comprise entre 1 et 5.', 400);

    await rideService.submitRideRating(rideId, rating, comment);

    return successResponse(res, { status: 'rated' }, 'Note enregistree avec succes');
  } catch (error) {
    return next(error);
  }
};

const getRideHistory = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    
    const result = await rideService.getRideHistory(req.user, page, limit);
    
    return successResponse(res, result, 'Historique recupere');
  } catch (error) {
    return next(error);
  }
};

const hideFromHistory = async (req, res, next) => {
  try {
    const { id } = req.params;
    await rideService.hideRideFromHistory(req.user, id);
    return successResponse(res, null, 'Course supprimee de votre historique.');
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