// src/models/Ride.js
// MODELE COURSE - Flux Gamifie & Securite Anti-Blocage
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
  },
  
  // Geolocalisation : Format GeoJSON strict exige pour le bon dispatch
  origin: {
    address: { type: String, required: true },
    coordinates: { type: [Number], required: true, index: '2dsphere' } 
  },
  destination: {
    address: { type: String, required: true },
    coordinates: { type: [Number], required: true, index: '2dsphere' } 
  },

  forfait: { 
    type: String, 
    enum: ['ECHO', 'STANDARD', 'VIP'], 
    default: 'STANDARD' 
  },

  // Moteur de Prix & Negociation
  distance: { type: Number, required: true }, 
  
  // Les options calculees par le serveur (Securite)
  priceOptions: [{
    label: { type: String, enum: ['ECO', 'STANDARD', 'PREMIUM'] },
    amount: { type: Number },
    description: { type: String }
  }],

  proposedPrice: { type: Number }, 
  
  price: { type: Number }, 

  status: {
    type: String,
    enum: [
      'searching',
      'negotiating',
      'accepted',
      'arrived',
      'in_progress',
      'completed',
      'cancelled'
    ],
    default: 'searching'
  },

  rejectedDrivers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

  // SECURITE : Timer pour tuer les negos zombies (60s)
  negotiationStartedAt: { type: Date },

  // Dates et tracabilite absolue
  createdAt: { type: Date, default: Date.now },
  acceptedAt: { type: Date },
  arrivedAt: { type: Date },
  startedAt: { type: Date },
  completedAt: { type: Date },
  
  cancellationReason: { type: String },
  rejectionReason: { type: String }
});

// Index Simples
rideSchema.index({ status: 1 });
rideSchema.index({ driver: 1 });

// SECURITE : Index Composite
// Optimise la verification "Est-ce que ce rider a DEJA une course active ?"
rideSchema.index({ rider: 1, status: 1 });

module.exports = mongoose.model('Ride', rideSchema);