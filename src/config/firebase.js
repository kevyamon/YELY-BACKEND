// src/config/firebase.js
// INITIALISATION FIREBASE ADMIN - Moteur Push
// CSCSM Level: Bank Grade

const admin = require('firebase-admin');
const { env } = require('./env');
const logger = require('./logger');

try {
  if (!admin.apps.length) {
    // Recuperation de la cle brute (priorite a process.env pour contourner tout parsing amont)
    const rawKey = process.env.FIREBASE_PRIVATE_KEY || env.FIREBASE_PRIVATE_KEY;

    if (!rawKey || !env.FIREBASE_PROJECT_ID || !env.FIREBASE_CLIENT_EMAIL) {
      throw new Error("Variables d'environnement Firebase manquantes.");
    }

    // NETTOYAGE ABSOLU (Anti-crash Render)
    // 1. On arrache TOUS les guillemets (simples ou doubles) qui auraient pu etre copies par erreur
    // 2. On force la conversion des chaines '\n' en veritables sauts de ligne
    const cleanKey = rawKey
      .replace(/["']/g, "") 
      .replace(/\\n/g, '\n');

    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: env.FIREBASE_PROJECT_ID,
        clientEmail: env.FIREBASE_CLIENT_EMAIL,
        privateKey: cleanKey,
      }),
    });
    
    logger.info('Moteur Push Firebase initialise avec succes');
  }
} catch (error) {
  logger.error('ERREUR FATALE: Impossible d\'initialiser Firebase !');
  logger.error(error.message);
  // On ne masque plus l'erreur. Si Firebase plante, on veut le voir immediatement dans les logs Render.
}

module.exports = admin;