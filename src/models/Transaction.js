const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  driver: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  amount: { type: Number, required: true },
  type: { type: String, enum: ['WEEKLY', 'MONTHLY'], required: true },
  status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING' },
  
  // Isolation financière
  assignedTo: { type: String, enum: ['SUPERADMIN', 'PARTNER'], required: true },
  
  // Preuve Cloudinary
  proofImageUrl: String,
  proofPublicId: String, // Pour la suppression automatique après validation
  
  senderPhone: String,
  rejectionReason: String,
  
  validatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

module.exports = mongoose.model('Transaction', transactionSchema);