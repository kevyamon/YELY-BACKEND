// src/controllers/rideController.js
// FACADE - Point d'entree unifie pour les routes (Dispatch vers les sous-controleurs)
// CSCSM Level: Bank Grade

const rideLifecycleController = require('./ride/rideLifecycleController');
const rideExecutionController = require('./ride/rideExecutionController');

module.exports = {
  // --- Logique du Cycle de Vie ---
  estimateRide: rideLifecycleController.estimateRide,
  requestRide: rideLifecycleController.requestRide,
  cancelRide: rideLifecycleController.cancelRide,
  emergencyCancel: rideLifecycleController.emergencyCancel,
  lockRide: rideLifecycleController.lockRide,
  submitPrice: rideLifecycleController.submitPrice,
  finalizeRide: rideLifecycleController.finalizeRide,
  getCurrentRide: rideLifecycleController.getCurrentRide, // AJOUT

  // --- Logique d'Execution ---
  markAsArrived: rideExecutionController.markAsArrived,
  startRide: rideExecutionController.startRide,
  completeRide: rideExecutionController.completeRide,
  rateRide: rideExecutionController.rateRide,
  getRideHistory: rideExecutionController.getRideHistory,
  hideFromHistory: rideExecutionController.hideFromHistory 
};