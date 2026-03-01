// src/services/rideService.js
// FACADE - Point d'entree unifie pour les sous-services de courses
// CSCSM Level: Bank Grade

const rideLifecycleService = require('./ride/rideLifecycleService');
const rideExecutionService = require('./ride/rideExecutionService');

module.exports = {
  // --- Fonctions deleguees a rideLifecycleService.js ---
  calculateHaversineDistance: rideLifecycleService.calculateHaversineDistance,
  getRouteDistance: rideLifecycleService.getRouteDistance,
  createRideRequest: rideLifecycleService.createRideRequest,
  cancelRideAction: rideLifecycleService.cancelRideAction,
  emergencyCancelUserRides: rideLifecycleService.emergencyCancelUserRides,
  lockRideForNegotiation: rideLifecycleService.lockRideForNegotiation,
  submitPriceProposal: rideLifecycleService.submitPriceProposal,
  finalizeProposal: rideLifecycleService.finalizeProposal,
  cancelSearchTimeout: rideLifecycleService.cancelSearchTimeout,
  releaseStuckNegotiations: rideLifecycleService.releaseStuckNegotiations,

  // --- Fonctions deleguees a rideExecutionService.js ---
  markRideAsArrived: rideExecutionService.markRideAsArrived,
  startRideSession: rideExecutionService.startRideSession,
  completeRideSession: rideExecutionService.completeRideSession,
  submitRideRating: rideExecutionService.submitRideRating,
  checkRideProgressOnLocationUpdate: rideExecutionService.checkRideProgressOnLocationUpdate
};