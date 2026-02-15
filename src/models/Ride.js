// src/models/Ride.js
// MODÈLE COURSE - Flux de Négociation "Gamifié"
// CSCSM Level: Bank Grade

const mongoose = require('mongoose');

const rideSchema = new mongoose.Schema({
  rider: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  driver: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User' 
    // Note: Peut être null tant que la négo n'est pas finie
  },
  
  // Géolocalisation
  origin: {
    address: { type: String, required: true },
    coordinates: { type: [Number], required: true, index: '2dsphere' }
  },
  destination: {
    address: { type: String, required: true },
    coordinates: { type: [Number], required: true, index: '2dsphere' }
  },

  // Moteur de Prix & Négociation
  distance: { type: Number, required: true }, // En Km
  
  // Les 3 options calculées par le serveur (Sécurité)
  priceOptions: [{
    label: { type: String, enum: ['ECO', 'STANDARD', 'PREMIUM'] },
    amount: { type: Number }, // Prix calculé
    description: { type: String } // Ex: "Rapide", "Équilibré"
  }],

  // Le choix du chauffeur
  proposedPrice: { type: Number }, 
  
  // Prix final validé
  price: { type: Number }, 

  status: {
    type: String,
    enum: [
      'searching',    // Recherche en cours (visible par les 5 chauffeurs)
      'negotiating',  // Un chauffeur a cliqué "Prendre", il choisit son prix
      'accepted',     // Client a dit OUI -> Le chauffeur vient
      'ongoing',      // En route
      'completed',    // Fini
      'cancelled'     // Annulé par l'un ou l'autre
    ],
    default: 'searching'
  },

  // Liste des chauffeurs qui ont ignoré ou été refusés (pour ne pas leur remonter la course)
  rejectedDrivers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

  // Dates
  createdAt: { type: Date, default: Date.now },
  acceptedAt: { type: Date },
  startedAt: { type: Date },
  completedAt: { type: Date },
  
  // Raisons
  cancellationReason: { type: String },
  rejectionReason: { type: String } // Si le client refuse le prix
});

// Index pour les recherches rapides
rideSchema.index({ status: 1 });
rideSchema.index({ rider: 1 });
rideSchema.index({ driver: 1 });

module.exports = mongoose.model('Ride', rideSchema);