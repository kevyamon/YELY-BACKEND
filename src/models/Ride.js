// src/models/Ride.js
// MODÈLE COURSE - Flux Gamifié & Sécurité Anti-Blocage (Iron Dome)
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
    // Peut être null tant que la négo n'est pas finie
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

  // Le choix du véhicule par le client
  forfait: { 
    type: String, 
    enum: ['ECHO', 'STANDARD', 'VIP'], 
    default: 'STANDARD' 
  },

  // Moteur de Prix & Négociation
  distance: { type: Number, required: true }, // En Km
  
  // Les 3 options calculées par le serveur (Sécurité)
  priceOptions: [{
    label: { type: String, enum: ['ECO', 'STANDARD', 'PREMIUM'] },
    amount: { type: Number },
    description: { type: String }
  }],

  // Le choix du chauffeur
  proposedPrice: { type: Number }, 
  
  // Prix final validé
  price: { type: Number }, 

  status: {
    type: String,
    enum: [
      'searching',    // Recherche en cours
      'negotiating',  // Chauffeur a locké, attente accord prix
      'accepted',     // Validé par client
      'ongoing',      // En route
      'completed',    // Fini
      'cancelled'     // Annulé
    ],
    default: 'searching'
  },

  // Liste des chauffeurs qui ont ignoré ou été refusés (Soft Reject)
  rejectedDrivers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

  // 🛡️ SÉCURITÉ IRON DOME : Timer pour tuer les négos zombies
  // Si ce champ est vieux de > 60s, le Cron libère le chauffeur
  negotiationStartedAt: { type: Date },

  // Dates
  createdAt: { type: Date, default: Date.now },
  acceptedAt: { type: Date },
  startedAt: { type: Date },
  completedAt: { type: Date },
  
  // Raisons
  cancellationReason: { type: String },
  rejectionReason: { type: String }
});

// Index Simples
rideSchema.index({ status: 1 });
rideSchema.index({ driver: 1 });

// 🛡️ SÉCURITÉ IRON DOME : Index Composite
// Optimise la vérification "Est-ce que ce rider a DÉJÀ une course active ?"
rideSchema.index({ rider: 1, status: 1 });

module.exports = mongoose.model('Ride', rideSchema);