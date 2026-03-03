// src/validations/subscriptionValidation.js
// CONTRATS DE DONNÉES SOUSCRIPTION - Zod Strict
// CSCSM Level: Bank Grade

const { z } = require('zod');

const submitProofSchema = z.object({
  // ATTENTION: Nous avons retiré 'amount' exprès.
  // Le client ne doit JAMAIS dicter le prix. Le backend le détermine via le planId.
  
  planId: z.enum(['WEEKLY', 'MONTHLY'], {
    errorMap: () => ({ message: "Type d'abonnement invalide. Attendu: WEEKLY ou MONTHLY." })
  }),
  
  senderPhone: z.string()
    .trim()
    .regex(/^\+?[0-9\s]{8,20}$/, 'Le format du numéro de téléphone expéditeur est invalide.')
    .transform(val => val.replace(/[\s-]/g, '')), // Nettoyage strict avant passage au contrôleur
    
}).strict({
  message: "La requête contient des champs non autorisés (Tentative de Mass Assignment détectée)."
}); 

module.exports = { submitProofSchema };