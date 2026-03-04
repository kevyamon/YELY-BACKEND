// src/models/Report.js
const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  message: { type: String, required: true, maxlength: 2000 },
  captures: [{ type: String }], // URLs Cloudinary
  status: { type: String, enum: ['OPEN', 'IN_PROGRESS', 'RESOLVED'], default: 'OPEN' },
  adminNote: { type: String, default: '' },
  // AJOUT SENIOR: Les deux drapeaux pour la Suppression Intelligente
  deletedByUser: { type: Boolean, default: false },
  deletedByAdmin: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('Report', reportSchema);