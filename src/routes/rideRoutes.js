const express = require('express');
const router = express.Router();
const { 
  requestRide, 
  acceptRide, 
  startRide, 
  completeRide 
} = require('../controllers/rideController');
const { protect, authorize } = require('../middleware/authMiddleware');

// Un client demande
router.post('/request', protect, authorize('rider', 'superadmin'), requestRide);

// Un chauffeur accepte/gère
router.post('/accept', protect, authorize('driver', 'superadmin'), acceptRide);
router.post('/start', protect, authorize('driver', 'superadmin'), startRide);
router.post('/complete', protect, authorize('driver', 'superadmin'), completeRide);

module.exports = router;