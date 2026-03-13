// src/models/Settings.js
// MODELE PARAMETRES - Configuration globale de l'application
// STANDARD: Industriel / Bank Grade

const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
  isPromoActive: { type: Boolean, default: false },
  isGlobalFreeAccess: { type: Boolean, default: false }, // Gratuite globale pour les chauffeurs
  promoMessage: { type: String, default: "Yely Regal ! Pour feter notre lancement, Yely vous offre l'acces VIP. Roulez sans abonnement !" },
  promoStartedAt: { type: Date, default: null }, // Memorisation du depart VIP pour la compensation
  
  // --- VERSIONING & MISES A JOUR (Vague 1 & 2) ---
  latestVersion: { type: String, default: "1.2.0", trim: true },
  mandatoryUpdate: { type: Boolean, default: true }, // Bloquant par defaut si active
  isOta: { type: Boolean, default: false }, // AJOUT : Enregistrement en base de la config OTA
  updateUrl: { type: String, default: "https://download-yely.onrender.com", trim: true },

  // --- GEOFENCING (ZONE DE SERVICE GLOBALE) ---
  isMapLocked: { type: Boolean, default: true },
  serviceCity: { type: String, default: "Mafere", trim: true },
  
  allowedCenter: {
    type: { type: String, default: 'Point' },
    coordinates: { 
      type: [Number], 
      default: [-3.00, 5.44],
      validate: {
        validator: function(v) {
          if (!Array.isArray(v) || v.length !== 2) return false;
          const [lng, lat] = v;
          return lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90;
        },
        message: 'Coordonnees centrales GPS invalides'
      }
    }
  },
  allowedRadiusKm: { 
    type: Number, 
    default: 20,
    min: [1, 'Le rayon global minimum est de 1km'] 
  },

  // --- DISPATCH CHAUFFEURS ---
  searchRadiusMeters: { 
    type: Number, 
    default: 5000, 
    min: [500, 'Le rayon de recherche minimum est de 500m'], 
    max: [50000, 'Le rayon de recherche maximum est de 50km'] 
  },
  
  // --- PAIEMENT & ABONNEMENT ---
  waveLinkWeekly: { type: String, default: "", trim: true },
  waveLinkMonthly: { type: String, default: "", trim: true },

  // --- OPTIMISATION DE CHARGE (ROUND ROBIN) ---
  isLoadReduced: { type: Boolean, default: false },
  weeklyCounter: { type: Number, default: 0 },
  monthlyCounter: { type: Number, default: 0 },
  lastAssignedAdminIndex: { type: Number, default: 0 },
  
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { 
  timestamps: true,
  strict: true 
});

const Settings = mongoose.models.Settings || mongoose.model('Settings', settingsSchema);

module.exports = Settings;