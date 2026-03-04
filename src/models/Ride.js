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

  // Historique conservant le type de vehicule pour la facturation ou les statistiques
  forfait: { 
    type: String, 
    enum: ['ECHO', 'STANDARD', 'VIP'], 
    default: 'STANDARD' 
  },

  // Capacite de transport (1 par defaut, 4 maximum)
  passengersCount: { 
    type: Number, 
    required: true, 
    default: 1, 
    min: [1, 'Il faut au moins 1 passager'], 
    max: [4, 'Maximum 4 passagers autorises'] 
  },

  // Tarification et distance
  distance: { type: Number, required: true }, 
  
  // Options de tarification pre-calculees par le moteur de prix
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

  // Securite : Nettoyage automatique des sessions de negociation orphelines
  negotiationStartedAt: { type: Date },

  // Tracabilite des etapes de la course
  createdAt: { type: Date, default: Date.now },
  acceptedAt: { type: Date },
  arrivedAt: { type: Date },
  startedAt: { type: Date },
  completedAt: { type: Date },
  
  cancellationReason: { type: String },
  rejectionReason: { type: String },

  // AJOUT SENIOR : Masquage Historique Individuel (Soft Delete)
  hiddenForRider: { type: Boolean, default: false },
  hiddenForDriver: { type: Boolean, default: false }
});

// Index de performance simples
rideSchema.index({ status: 1 });
rideSchema.index({ driver: 1 });

// Index de performance composite pour la verification d'unicite des courses actives
rideSchema.index({ rider: 1, status: 1 });

module.exports = mongoose.model('Ride', rideSchema);