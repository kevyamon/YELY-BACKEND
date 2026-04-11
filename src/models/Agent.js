// src/models/Agent.js
// MODELE AGENT - Force de vente terrain Yely
// CSCSM Level: Bank Grade

const mongoose = require('mongoose');

const agentSchema = new mongoose.Schema({
  name: { 
    type: String, 
    required: [true, 'Le nom est obligatoire'],
    trim: true,
    maxlength: [50, 'Le nom ne peut depasser 50 caracteres']
  },
  phone: { 
    type: String, 
    required: [true, 'Le telephone est obligatoire'],
    unique: true,
    trim: true 
  },
  agentId: { 
    type: String, 
    required: true, 
    unique: true,
    index: true 
  },
  totalEarned: { 
    type: Number, 
    default: 0 
  },
  isActive: { 
    type: Boolean, 
    default: true 
  }
}, { 
  timestamps: true 
});

module.exports = mongoose.model('Agent', agentSchema);