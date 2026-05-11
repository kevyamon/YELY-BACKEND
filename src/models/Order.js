// src/models/Order.js
// MODÈLE COMMANDE - Flux E-commerce & Logistique
// STANDARD: Bank Grade (Traçabilité Totale)

const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  seller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  driver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  
  items: [{
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true
    },
    name: String,
    quantity: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true }
  }],

  // Financier
  itemsPrice: { type: Number, required: true, default: 0 },
  deliveryPrice: { type: Number, required: true, default: 0 },
  totalPrice: { 
    type: Number, 
    required: true, 
    default: 0,
    comment: 'Fusion itemsPrice + deliveryPrice pour affichage client unique'
  },
  
  paymentMethod: {
    type: String,
    default: 'Cash',
    enum: ['Cash']
  },

  // Logistique
  shippingAddress: {
    address: { type: String, required: true },
    coordinates: {
      type: [Number], // [lng, lat]
      required: true,
      index: '2dsphere'
    }
  },

  status: {
    type: String,
    enum: [
      'pending',      // Client a commandé
      'confirmed',    // Vendeur a validé
      'searching',    // En recherche de livreur (dispatch)
      'picked_up',    // Livreur a récupéré le colis
      'arrived',      // Livreur est proche du client (Geofencing)
      'delivered',    // Colis livré, cash encaissé
      'cancelled',    // Annulée par l'un des acteurs
      'rejected'      // Vendeur a refusé (rupture etc)
    ],
    default: 'pending'
  },

  // Timeline & Tracabilité
  history: [{
    status: String,
    timestamp: { type: Date, default: Date.now },
    comment: String
  }],

  confirmedAt: Date,
  pickedUpAt: Date,
  deliveredAt: Date,
  cancelledAt: Date,

  // Lien avec la course VTC (pour réutiliser le dispatch/tracking)
  rideId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Ride',
    default: null
  }
}, {
  timestamps: true
});

orderSchema.index({ status: 1, customer: 1 });
orderSchema.index({ status: 1, seller: 1 });
orderSchema.index({ status: 1, driver: 1 });

const Order = mongoose.models.Order || mongoose.model('Order', orderSchema);

module.exports = Order;
