// src/services/rideService.js
// FLUX DE NÉGOCIATION & TRANSACTION - Atomicité MongoDB
// CSCSM Level: Bank Grade

const mongoose = require('mongoose');
const Ride = require('../models/Ride');
const User = require('../models/User');
const Settings = require('../models/Settings');
const pricingService = require('./pricingService');
const AppError = require('../utils/AppError');

// Géométrie (Haversine)
const calculateDistanceKm = (coords1, coords2) => {
  const [lng1, lat1] = coords1;
  const [lng2, lat2] = coords2;
  const R = 6371; 
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng/2) * Math.sin(dLng/2);
  return parseFloat((R * c).toFixed(2));
};

/**
 * 1. CRÉER LA DEMANDE (Rider)
 * Calcule les options mais ne les montre pas encore.
 */
const createRideRequest = async (riderId, rideData) => {
  const { origin, destination } = rideData;
  const distance = calculateDistanceKm(origin.coordinates, destination.coordinates);

  // Sécurité Anti-Fraude Distance
  if (distance < 0.1) throw new AppError('Distance invalide (<100m).', 400);

  // Génération des 3 prix sécurisés
  const priceOptions = await pricingService.generatePriceOptions(distance);

  const ride = await Ride.create({
    rider: riderId,
    origin,
    destination,
    distance,
    priceOptions, // On stocke les choix possibles
    status: 'searching',
    rejectedDrivers: []
  });

  // Recherche des chauffeurs (Logic Dispatch)
  // On exclut ceux qui sont déjà dans rejectedDrivers (vide au début)
  const drivers = await User.find({
    role: 'driver',
    isAvailable: true,
    isBanned: false,
    _id: { $nin: ride.rejectedDrivers },
    currentLocation: {
      $near: {
        $geometry: { type: 'Point', coordinates: origin.coordinates },
        $maxDistance: 5000 // 5km
      }
    }
  }).limit(5); // Les 5 plus proches

  return { ride, drivers };
};

/**
 * 2. LOCKER LA COURSE (Chauffeur clique "Prendre")
 * C'est ici l'atomicité critique : Premier arrivé, premier servi.
 */
const lockRideForNegotiation = async (rideId, driverId) => {
  // On cherche une course "searching". Si elle est déjà "negotiating", ça échoue.
  const ride = await Ride.findOneAndUpdate(
    { _id: rideId, status: 'searching' },
    { 
      status: 'negotiating', 
      driver: driverId 
    },
    { new: true } // Retourne la version modifiée
  );

  if (!ride) {
    // Si null, c'est qu'un autre chauffeur a été plus rapide
    throw new AppError('Cette course a déjà été saisie par un autre chauffeur.', 409);
  }

  return ride;
};

/**
 * 3. PROPOSER UN PRIX (Chauffeur choisit 1 des 3 options)
 */
const submitPriceProposal = async (rideId, driverId, selectedAmount) => {
  const ride = await Ride.findOne({ _id: rideId, driver: driverId, status: 'negotiating' });
  if (!ride) throw new AppError('Course non trouvée ou session expirée.', 404);

  // SÉCURITÉ : On vérifie que le prix soumis est bien L'UN des 3 calculés
  // Un hacker ne peut pas envoyer "1000000" via Postman
  const isValidOption = ride.priceOptions.some(opt => opt.amount === selectedAmount);
  if (!isValidOption) {
    throw new AppError('Prix invalide (Fraude détectée).', 400);
  }

  ride.proposedPrice = selectedAmount;
  // On reste en statut "negotiating", on attend la validation client
  await ride.save();

  return ride;
};

/**
 * 4. ACCEPTER OU REFUSER (Client)
 */
const finalizeProposal = async (rideId, riderId, decision) => {
  const session = await mongoose.startSession();
  let result;

  await session.withTransaction(async () => {
    const ride = await Ride.findOne({ _id: rideId, rider: riderId, status: 'negotiating' }).session(session);
    if (!ride) throw new AppError('Demande invalide.', 404);

    if (decision === 'ACCEPTED') {
      // Le client valide -> On verrouille tout
      ride.status = 'accepted';
      ride.price = ride.proposedPrice;
      ride.acceptedAt = new Date();
      await ride.save({ session });
      
      // Chauffeur n'est plus dispo
      await User.findByIdAndUpdate(ride.driver, { isAvailable: false }, { session });
      
      result = { status: 'ACCEPTED', ride };

    } else {
      // Le client refuse -> SOFT REJECT (Amélioration)
      // On libère la course pour les autres, on rejette ce chauffeur
      const rejectedDriverId = ride.driver;
      
      ride.status = 'searching'; // Retour au pool !
      ride.driver = null; // Plus de chauffeur attitré
      ride.proposedPrice = null; // Reset prix
      ride.rejectedDrivers.push(rejectedDriverId); // Blacklist temporaire pour cette course
      
      await ride.save({ session });
      
      result = { status: 'SEARCHING_AGAIN', ride, rejectedDriverId };
    }
  });

  session.endSession();
  return result;
};

// ... startRideSession et completeRideSession restent inchangés
const startRideSession = async (driverId, rideId) => {
    const ride = await Ride.findOneAndUpdate(
      { _id: rideId, driver: driverId, status: 'accepted' },
      { status: 'ongoing', startedAt: new Date() },
      { new: true }
    );
    if (!ride) throw new AppError('Impossible de démarrer la course.', 400);
    return ride;
  };
  
  const completeRideSession = async (driverId, rideId) => {
    const session = await mongoose.startSession();
    let result;
    await session.withTransaction(async () => {
      const ride = await Ride.findOneAndUpdate(
        { _id: rideId, driver: driverId, status: 'ongoing' },
        { status: 'completed', completedAt: new Date() },
        { new: true, session }
      );
      if (!ride) throw new AppError('Course introuvable ou statut incorrect.', 400);
  
      await User.findByIdAndUpdate(driverId, { isAvailable: true }, { session });
      result = ride;
    });
    session.endSession();
    return result;
  };

module.exports = {
  createRideRequest,
  lockRideForNegotiation,
  submitPriceProposal,
  finalizeProposal,
  startRideSession,
  completeRideSession
};