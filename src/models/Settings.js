const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
  isPromoActive: { type: Boolean, default: false },
  
  // --- GEOFENCING (ZONE DE SERVICE) ---
  isMapLocked: { type: Boolean, default: true },
  serviceCity: { type: String, default: "Maféré" },
  
  allowedCenter: {
    type: { type: String, default: 'Point' },
    coordinates: { type: [Number], default: [-3.00, 5.44] } // Long, Lat Maféré
  },
  allowedRadiusKm: { type: Number, default: 20 },
  
  waveLinkWeekly: { type: String, default: "" },
  waveLinkMonthly: { type: String, default: "" },
  
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

module.exports = mongoose.model('Settings', settingsSchema);