// src/models/User.js
// MODÈLE UTILISATEUR - Index optimisés, Validation stricte, Hash sécurisé
// CSCSM Level: Bank Grade

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const { SECURITY_CONSTANTS } = require('../config/env');

const userSchema = new mongoose.Schema({
  // ═══════════════════════════════════════════════════════════
  // IDENTITÉ
  // ═══════════════════════════════════════════════════════════
  
  name: { 
    type: String, 
    required: [true, 'Le nom est obligatoire'],
    trim: true,
    minlength: [2, 'Le nom doit faire au moins 2 caractères'],
    maxlength: [50, 'Le nom ne peut dépasser 50 caractères'],
    match: [/^[a-zA-Z\s'-]+$/, 'Caractères autorisés: lettres, espaces, - et \'']
  },
  
  email: { 
    type: String, 
    required: [true, 'L\'email est obligatoire'],
    unique: true,
    lowercase: true,
    trim: true,
    maxlength: [254, 'Email trop long'],
    match: [/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/, 'Format email invalide']
  },
  
  phone: { 
    type: String, 
    required: [true, 'Le téléphone est obligatoire'],
    unique: true,
    trim: true,
    match: [/^\+?[0-9\s]{8,20}$/, 'Format téléphone invalide']
  },
  
  password: { 
    type: String, 
    required: [true, 'Le mot de passe est obligatoire'],
    minlength: [8, 'Mot de passe trop court'],
    select: false // Ne jamais retourner par défaut
  },

  // ═══════════════════════════════════════════════════════════
  // RÔLE & SÉCURITÉ
  // ═══════════════════════════════════════════════════════════
  
  role: {
    type: String,
    enum: {
      values: ['rider', 'driver', 'admin', 'superadmin'],
      message: 'Rôle {VALUE} non autorisé'
    },
    default: 'rider'
  },

  isBanned: { 
    type: Boolean, 
    default: false,
    index: true // Index pour requêtes rapides de vérification
  },
  
  banReason: { 
    type: String, 
    default: '',
    maxlength: [500, 'Raison de ban trop longue']
  },

  // ═══════════════════════════════════════════════════════════
  // GÉOLOCALISATION (Index 2dsphere pour requêtes géo)
  // ═══════════════════════════════════════════════════════════
  
  currentLocation: {
    type: { 
      type: String, 
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: { 
      type: [Number], // [longitude, latitude]
      default: [0, 0],
      validate: {
        validator: function(coords) {
          if (coords[0] === 0 && coords[1] === 0) return true; // Valeur par défaut
          return coords.length === 2 &&
                 coords[0] >= -180 && coords[0] <= 180 && // longitude
                 coords[1] >= -90 && coords[1] <= 90;     // latitude
        },
        message: 'Coordonnées GPS invalides'
      }
    }
  },

  // ═══════════════════════════════════════════════════════════
  // ÉTAT CHAUFFEUR
  // ═══════════════════════════════════════════════════════════
  
  isAvailable: { 
    type: Boolean, 
    default: false,
    index: true // Index pour requêtes chauffeurs disponibles
  },

  vehicle: {
    category: {
      type: String,
      enum: ['ECHO', 'STANDARD', 'VIP'],
      default: null
    },
    model: { 
      type: String, 
      default: '',
      maxlength: [50, 'Modèle trop long']
    },
    plate: { 
      type: String, 
      default: '',
      maxlength: [20, 'Plaque trop longue'],
      match: [/^[^<>{}]*$/, 'Caractères invalides dans la plaque']
    },
    color: { 
      type: String, 
      default: '',
      maxlength: [30, 'Couleur trop longue']
    }
  },

  // ═══════════════════════════════════════════════════════════
  // ABONNEMENT
  // ═══════════════════════════════════════════════════════════
  
  subscription: {
    isActive: { 
      type: Boolean, 
      default: false,
      index: true
    },
    hoursRemaining: { 
      type: Number, 
      default: 0,
      min: [0, 'Crédit ne peut être négatif']
    },
    lastCheckTime: { 
      type: Date, 
      default: Date.now 
    }
  },

  // ═══════════════════════════════════════════════════════════
  // DOCUMENTS (Cloudinary URLs)
  // ═══════════════════════════════════════════════════════════
  
  documents: {
    idCard: { 
      type: String, 
      default: '',
      match: [/^https?:\/\/.*/, 'URL invalide']
    },
    license: { 
      type: String, 
      default: '',
      match: [/^https?:\/\/.*/, 'URL invalide']
    },
    insurance: { 
      type: String, 
      default: '',
      match: [/^https?:\/\/.*/, 'URL invalide']
    }
  }

}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// ═══════════════════════════════════════════════════════════
// INDEX OPTIMISÉS (Performance + Unicité)
// ═══════════════════════════════════════════════════════════

// Index géospatial pour requêtes "chauffeurs proches"
userSchema.index({ currentLocation: '2dsphere' });

// Index composé pour requêtes chauffeurs disponibles avec abonnement actif
userSchema.index({ 
  role: 1, 
  isAvailable: 1, 
  'subscription.isActive': 1,
  'vehicle.category': 1 
});

// Index pour recherches admin
userSchema.index({ role: 1, isBanned: 1, createdAt: -1 });

// ═══════════════════════════════════════════════════════════
// MIDDLEWARES HOOKS
// ═══════════════════════════════════════════════════════════

// Hash du mot de passe avant sauvegarde (uniquement si modifié)
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    this.password = await bcrypt.hash(this.password, SECURITY_CONSTANTS.BCRYPT_ROUNDS);
    next();
  } catch (error) {
    next(error);
  }
});

// Normalisation avant sauvegarde
userSchema.pre('save', function(next) {
  if (this.isModified('email')) {
    this.email = this.email.toLowerCase().trim();
  }
  if (this.isModified('phone')) {
    this.phone = this.phone.replace(/\s/g, '');
  }
  if (this.isModified('name')) {
    this.name = this.name.trim();
  }
  next();
});

// ═══════════════════════════════════════════════════════════
// MÉTHODES INSTANCE
// ═══════════════════════════════════════════════════════════

// Comparaison mot de passe (instance)
userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// ═══════════════════════════════════════════════════════════
// MÉTHODES STATIQUES
// ═══════════════════════════════════════════════════════════

// Comparaison mot de passe (statique pour timing constant)
userSchema.statics.comparePasswordStatic = async function(candidate, hash) {
  return bcrypt.compare(candidate, hash);
};

// Recherche chauffeurs disponibles près d'une position
userSchema.statics.findAvailableDriversNear = function(coordinates, maxDistance = 5000, vehicleType) {
  const query = {
    role: 'driver',
    isAvailable: true,
    'subscription.isActive': true,
    currentLocation: {
      $near: {
        $geometry: { type: 'Point', coordinates },
        $maxDistance: maxDistance
      }
    }
  };
  
  if (vehicleType) {
    query['vehicle.category'] = vehicleType;
  }
  
  return this.find(query).select('-password -__v');
};

module.exports = mongoose.model('User', userSchema);