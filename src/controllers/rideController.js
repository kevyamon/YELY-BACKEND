const Ride = require('../models/Ride');
const User = require('../models/User');
const Settings = require('../models/Settings'); // Indispensable pour le lock

// @desc    Demander une course avec vérification de zone
// @route   POST /api/rides/request
const requestRide = async (req, res) => {
  const { origin, destination, forfait, price, distance } = req.body;
  const io = req.app.get('socketio');

  try {
    // --- SÉCURITÉ GÉOGRAPHIQUE : Lock Maféré ---
    const settings = await Settings.findOne();
    if (settings && settings.isMapLocked) {
      const city = settings.serviceCity.toLowerCase();
      // On vérifie si l'adresse de départ contient le nom de la ville autorisée
      if (!origin.address.toLowerCase().includes(city)) {
        return res.status(403).json({ 
          message: `Désolé, Yély opère exclusivement sur ${settings.serviceCity} pour le moment.` 
        });
      }
    }

    const ride = await Ride.create({
      rider: req.user._id,
      origin, 
      destination, 
      forfait, 
      price, 
      distance,
      status: 'requested'
    });

    const availableDrivers = await User.find({
      role: 'driver',
      isAvailable: true,
      'vehicle.type': forfait,
      'subscription.isActive': true,
      currentLocation: {
        $near: {
          $geometry: { type: "Point", coordinates: origin.coordinates },
          $maxDistance: 5000 // 5km de rayon
        }
      }
    });

    if (availableDrivers.length > 0) {
      availableDrivers.forEach(driver => {
        io.to(driver._id.toString()).emit('new_ride_request', {
          rideId: ride._id,
          riderName: req.user.name,
          origin: origin.address,
          destination: destination.address,
          price,
          distance
        });
      });

      res.status(201).json({ message: "Recherche en cours...", rideId: ride._id });
    } else {
      ride.status = 'cancelled';
      await ride.save();
      res.status(404).json({ message: "Aucun chauffeur Yély disponible ici." });
    }
  } catch (error) {
    res.status(500).json({ message: "Erreur lors de la création de la course." });
  }
};

// @desc    Accepter une course
const acceptRide = async (req, res) => {
  const { rideId } = req.body;
  const io = req.app.get('socketio');

  try {
    const ride = await Ride.findById(rideId).populate('rider');

    if (!ride) return res.status(404).json({ message: "Course introuvable." });
    if (ride.status !== 'requested') return res.status(400).json({ message: "Cette course n'est plus disponible." });

    ride.driver = req.user._id;
    ride.status = 'accepted';
    await ride.save();

    await User.findByIdAndUpdate(req.user._id, { isAvailable: false });

    const driverWithVehicle = await User.findById(req.user._id);

    io.to(ride.rider._id.toString()).emit('ride_accepted', {
      rideId: ride._id,
      driverName: req.user.name,
      vehicle: driverWithVehicle.vehicle,
      driverLocation: driverWithVehicle.currentLocation.coordinates
    });

    res.status(200).json({ message: "Course acceptée. En route !", ride });
  } catch (error) {
    res.status(500).json({ message: "Erreur lors de l'acceptation." });
  }
};

// @desc    Marquer le client comme étant à bord
const startRide = async (req, res) => {
  const { rideId } = req.body;
  const io = req.app.get('socketio');

  try {
    const ride = await Ride.findById(rideId);
    if (!ride) return res.status(404).json({ message: "Course introuvable." });

    ride.status = 'ongoing';
    await ride.save();

    io.to(ride.rider.toString()).emit('ride_started');
    res.status(200).json({ message: "Course démarrée. Destination finale !" });
  } catch (error) {
    res.status(500).json({ message: "Erreur lors du démarrage." });
  }
};

// @desc    Terminer la course
const completeRide = async (req, res) => {
  const { rideId } = req.body;
  const io = req.app.get('socketio');

  try {
    const ride = await Ride.findById(rideId);
    if (!ride) return res.status(404).json({ message: "Course introuvable." });

    ride.status = 'completed';
    await ride.save();

    await User.findByIdAndUpdate(req.user._id, { isAvailable: true });

    io.to(ride.rider.toString()).emit('ride_completed');
    res.status(200).json({ message: "Course terminée. Merci d'avoir choisi Yély." });
  } catch (error) {
    res.status(500).json({ message: "Erreur lors de la finalisation." });
  }
};

module.exports = { requestRide, acceptRide, startRide, completeRide };