// src/validations/subscriptionValidation.js
// CONTRATS DE DONNÉES SOUSCRIPTION - Zod Strict
// CSCSM Level: Bank Grade

const { z } = require('zod');

const submitProofSchema = z.object({
  amount: z.preprocess((val) => Number(val), z.number()
    .positive('Le montant doit être supérieur à 0')
    .max(1000000, 'Montant anormalement élevé')),
    
  type: z.enum(['WEEKLY', 'MONTHLY'], {
    errorMap: () => ({ message: "Type d'abonnement invalide (WEEKLY ou MONTHLY)" })
  }),
  
  senderPhone: z.string()
    .regex(/^\+?[0-9\s]{8,20}$/, 'Numéro de téléphone invalide')
    .trim()
}).strict(); // Rejette tout champ caché

module.exports = { submitProofSchema };