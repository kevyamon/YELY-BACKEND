// src/models/Ride.js
// MODÈLE COURSE - Index géospatial, Validation coordonnées, Historique complet
// CSCSM Level: Bank Grade

const mongoose = require('mongoose');

const pointSchema = new mongoose.Schema({
  address: {
    type: String,
    required: [true, 'Adresse requise'],
    trim: true,
    maxlength: [200, 'Adresse trop longue']
  },
  coordinates: {
    type: [Number], // [longitude, latitude] - MongoDB GeoJSON standard
    required: [true, 'Coordonnées requises'],
    validate: {
      validator: function(coords) {
        return Array.isArray(coords) && 
               coords.length === 2 &&
               typeof coords[0] === 'number' && // longitude
               typeof coords[1] === 'number' && // latitude
               coords[0] >= -180 && coords[0] <= 180 &&
               coords[1] >= -90 && coords[1] <= 90;
      },
      message: 'Coordonnées GPS invalides. Format: [longitude, latitude]'
    }
  }
}, { _id: false });

const rideSchema = new mongoose.Schema({
  // ═══════════════════════════════════════════════════════════
  // ACTEURS
  // ═══════════════════════════════════════════════════════════
  
  rider: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Passager requis'],
    index: true
  },
  
  driver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true
  },

  // ═══════════════════════════════════════════════════════════
  // STATUT (Machine à états)
  // ═══════════════════════════════════════════════════════════
  
  status: {
    type: String,
    enum: {
      values: ['requested', 'accepted', 'ongoing', 'completed', 'cancelled', 'disputed'],
      message: 'Statut {VALUE} non reconnu'
    },
    default: 'requested',
    index: true
  },

  // ═══════════════════════════════════════════════════════════
  // DÉTAILS COURSE
  // ═══════════════════════════════════════════════════════════
  
  forfait: {
    type: String,
    enum: ['ECHO', 'STANDARD', 'VIP'],
    required: [true, 'Forfait requis']
  },

  origin: {
    type: pointSchema,
    required: [true, 'Point de départ requis']
  },

  destination: {
    type: pointSchema,
    required: [true, 'Destination requise']
  },

  // ═══════════════════════════════════════════════════════════
  // TARIFICATION (Verrouillée côté serveur)
  // ═══════════════════════════════════════════════════════════
  
  price: {
    type: Number,
    required: [true, 'Prix requis'],
    min: [0, 'Prix ne peut être négatif'],
    max: [50000, 'Prix anormal (max 50k)']
  },

  distance: {
    type: Number, // en km
    required: [true, 'Distance requise'],
    min: [0, 'Distance invalide'],
    max: [100, 'Distance trop grande (max 100km)']
  },

  duration: {
    type: Number, // en minutes, estimé
    default: null
  },

  // ═══════════════════════════════════════════════════════════
  // TIMESTAMPS MÉTIER
  // ═══════════════════════════════════════════════════════════
  
  requestedAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  
  acceptedAt: {
    type: Date,
    default: null
  },
  
  startedAt: {
    type: Date,
    default: null
  },
  
  completedAt: {
    type: Date,
    default: null
  },

  // ═══════════════════════════════════════════════════════════
  // ANNULATION / LITIGE
  // ═══════════════════════════════════════════════════════════
  
  cancellationReason: {
    type: String,
    enum: ['NO_DRIVERS_AVAILABLE', 'RIDER_CANCELLED', 'DRIVER_CANCELLED', 'TIMEOUT', 'OTHER'],
    default: null
  },
  
  cancelledBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },

  // ═══════════════════════════════════════════════════════════
  // INNOVATION PANCARTE
  // ═══════════════════════════════════════════════════════════
  
  pancarteShown: {
    type: Boolean,
    default: false
  },
  
  pancarteShownAt: {
    type: Date,
    default: null
  },

  // ═══════════════════════════════════════════════════════════
  // MÉTADATA
  // ═══════════════════════════════════════════════════════════
  
  ipAddress: {
    type: String,
    default: null // Pour audit sécurité
  },
  
  userAgent: {
    type: String,
    default: null
  }

}, {
  timestamps: true, // createdAt, updatedAt automatiques
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// ═══════════════════════════════════════════════════════════
// INDEX CRITIQUES (Performance + Intégrité)
// ═══════════════════════════════════════════════════════════

// Index géospatial sur origine (pour recherches "courses près d'ici")
rideSchema.index({ 'origin.coordinates': '2dsphere' });

// Index composite: statut + forfait + date (pour dashboard admin)
rideSchema.index({ status: 1, forfait: 1, requestedAt: -1 });

// Index: chauffeur + statut (pour "mes courses en cours")
rideSchema.index({ driver: 1, status: 1, requestedAt: -1 });

// Index: passager + statut (pour historique)
rideSchema.index({ rider: 1, status: 1, requestedAt: -1 });

// Index TTL optionnel: archiver vieilles courses après 90 jours (si besoin)
// rideSchema.index({ completedAt: 1 }, { expireAfterSeconds: 7776000, partialFilterExpression: { status: 'completed' } });

// ═══════════════════════════════════════════════════════════
// VIRTUALS (Calculés à la volée)
// ═══════════════════════════════════════════════════════════

rideSchema.virtual('durationMinutes').get(function() {
  if (!this.startedAt || !this.completedAt) return null;
  return Math.round((this.completedAt - this.startedAt) / 1000 / 60);
});

rideSchema.virtual('waitTimeSeconds').get(function() {
  if (!this.requestedAt || !this.acceptedAt) return null;
  return Math.round((this.acceptedAt - this.requestedAt) / 1000);
});

// ═══════════════════════════════════════════════════════════
// MÉTHODES STATIQUES (Analytics & Recherche)
// ═══════════════════════════════════════════════════════════

// Statistiques chauffeur sur période
rideSchema.statics.getDriverStats = async function(driverId, startDate, endDate) {
  return this.aggregate([
    {
      $match: {
        driver: new mongoose.Types.ObjectId(driverId),
        status: 'completed',
        completedAt: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: null,
        totalRides: { $sum: 1 },
        totalEarnings: { $sum: '$price' },
        avgPrice: { $avg: '$price' },
        totalDistance: { $sum: '$distance' }
      }
    }
  ]);
};

// Recherche courses actives dans zone (pour admin/map)
rideSchema.statics.findActiveInZone = function(coordinates, radiusKm) {
  return this.find({
    status: { $in: ['requested', 'accepted', 'ongoing'] },
    'origin.coordinates': {
      $near: {
        $geometry: { type: 'Point', coordinates },
        $maxDistance: radiusKm * 1000
      }
    }
  }).populate('rider driver', 'name phone');
};

module.exports = mongoose.model('Ride', rideSchema);