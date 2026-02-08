const mongoose = require('mongoose');

const rideSchema = new mongoose.Schema({
  rider: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  driver: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  
  status: { 
    type: String, 
    enum: ['requested', 'accepted', 'ongoing', 'completed', 'cancelled'], 
    default: 'requested' 
  },

  forfait: { type: String, enum: ['ECHO', 'STANDARD', 'VIP'], required: true },
  
  origin: {
    address: String,
    coordinates: { type: [Number], required: true } // [long, lat]
  },
  destination: {
    address: String,
    coordinates: { type: [Number], required: true } // [long, lat]
  },

  price: { type: Number, required: true },
  distance: String,
  duration: String,

  // Pour l'innovation "Pancarte Numérique"
  pancarteShown: { type: Boolean, default: false }

}, { timestamps: true });

module.exports = mongoose.model('Ride', rideSchema);