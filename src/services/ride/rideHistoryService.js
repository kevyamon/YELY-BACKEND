// src/services/ride/rideHistoryService.js
// SERVICE METIER - Notation et historique individuel des courses
// STANDARD: Industriel / Bank Grade

const mongoose = require('mongoose');
const Ride = require('../../models/Ride');
const User = require('../../models/User');
const AppError = require('../../utils/AppError');

const submitRideRating = async (rideId, rating, comment) => {
  const session = await mongoose.startSession();
  let result;

  try {
    await session.withTransaction(async () => {
      const ride = await Ride.findById(rideId).session(session);
      if (!ride) throw new AppError('Course introuvable.', 404);

      if (ride.status !== 'completed') {
        throw new AppError('La course doit etre terminee pour etre notee.', 400);
      }

      if (ride.ratingGiven) {
        throw new AppError('Cette course a deja ete notee.', 400);
      }

      if (ride.driver) {
        const driver = await User.findById(ride.driver).session(session);
        if (driver) {
          const currentRating = driver.rating || 5.0;
          const currentCount = driver.ratingCount || 0;
          
          const newCount = currentCount + 1;
          const newRating = ((currentRating * currentCount) + rating) / newCount;

          driver.rating = parseFloat(newRating.toFixed(2));
          driver.ratingCount = newCount;
          await driver.save({ session });
        }
      }

      ride.ratingGiven = rating;
      await ride.save({ session });
      result = ride;
    });
  } finally {
    await session.endSession();
  }
  return result;
};

const getRideHistory = async (user, page = 1, limit = 20) => {
  const skip = (page - 1) * limit;
  const filter = {};
  
  if (user.role === 'driver') {
    filter.driver = user._id;
    filter.hiddenForDriver = { $ne: true };
  } else {
    filter.rider = user._id;
    filter.hiddenForRider = { $ne: true };
  }

  filter.status = { $nin: ['pending', 'searching'] };

  const rides = await Ride.find(filter)
    .populate('rider', 'name profilePicture')
    .populate('driver', 'name profilePicture vehicle')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  const total = await Ride.countDocuments(filter);

  return {
    rides,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    }
  };
};

const hideRideFromHistory = async (user, rideId) => {
  const ride = await Ride.findById(rideId);
  if (!ride) throw new AppError("Course introuvable.", 404);

  if (user.role === 'driver' && ride.driver && ride.driver.toString() === user._id.toString()) {
    ride.hiddenForDriver = true;
  } else if (ride.rider && ride.rider.toString() === user._id.toString()) {
    ride.hiddenForRider = true;
  } else {
    throw new AppError("Non autorise a masquer cette course.", 403);
  }

  await ride.save();
  return true;
};

const hideAllRidesFromHistory = async (user) => {
  if (user.role === 'driver') {
    await Ride.updateMany(
      { driver: user._id, status: { $in: ['completed', 'cancelled'] } },
      { $set: { hiddenForDriver: true } }
    );
  } else {
    await Ride.updateMany(
      { rider: user._id, status: { $in: ['completed', 'cancelled'] } },
      { $set: { hiddenForRider: true } }
    );
  }
  return true;
};

module.exports = {
  submitRideRating,
  getRideHistory,
  hideRideFromHistory,
  hideAllRidesFromHistory
};
