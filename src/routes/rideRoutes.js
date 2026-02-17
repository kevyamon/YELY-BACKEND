const express = require('express');
const router = express.Router();
const rideController = require('../controllers/rideController');
const { protect, authorize } = require('../middleware/authMiddleware');
const validate = require('../middleware/validationMiddleware');
const { 
  requestRideSchema, 
  rideActionSchema, 
  submitPriceSchema, 
  finalizeRideSchema 
} = require('../validations/rideValidation');

router.post('/request', protect, authorize('rider', 'superadmin'), validate(requestRideSchema), rideController.requestRide);
router.post('/lock', protect, authorize('driver', 'superadmin'), validate(rideActionSchema), rideController.lockRide);
router.post('/propose', protect, authorize('driver', 'superadmin'), validate(submitPriceSchema), rideController.submitPrice);
router.post('/finalize', protect, authorize('rider', 'superadmin'), validate(finalizeRideSchema), rideController.finalizeRide);
router.post('/start', protect, authorize('driver', 'superadmin'), validate(rideActionSchema), rideController.startRide);
router.post('/complete', protect, authorize('driver', 'superadmin'), validate(rideActionSchema), rideController.completeRide);

module.exports = router;