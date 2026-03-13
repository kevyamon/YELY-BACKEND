// src/config/firebase.js
// INITIALISATION FIREBASE ADMIN - Moteur Push
// CSCSM Level: Bank Grade

const admin = require('firebase-admin');
const { env } = require('./env');
const logger = require('./logger');

try {
  if (!admin.apps.length) {
    if (env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: env.FIREBASE_PROJECT_ID,
          clientEmail: env.FIREBASE_CLIENT_EMAIL,
          privateKey: env.FIREBASE_PRIVATE_KEY, 
        }),
      });
      logger.info('Moteur Push Firebase initialise avec succes');
    } else {
      logger.warn('Variables Firebase manquantes. Push notifications desactivees temporairement.');
    }
  }
} catch (error) {
  logger.error('Erreur critique lors de l\'initialisation de Firebase:', error);
}

module.exports = admin;