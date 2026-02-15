// src/config/firebase.js
// INITIALISATION FIREBASE ADMIN - Moteur Push
// CSCSM Level: Bank Grade

const admin = require('firebase-admin');
const { env } = require('./env');
const logger = require('./logger');

try {
  // On vérifie si les variables sont présentes (pour ne pas faire planter le dev local)
  if (env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: env.FIREBASE_PROJECT_ID,
        clientEmail: env.FIREBASE_CLIENT_EMAIL,
        // Remplace les faux retours à la ligne par de vrais (nécessaire sur Render/Heroku)
        privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
    });
    logger.info('✅ Moteur Push Firebase initialisé avec succès');
  } else {
    logger.warn('⚠️ Variables Firebase manquantes. Push notifications désactivées temporairement.');
  }
} catch (error) {
  logger.error('❌ Erreur critique lors de l\'initialisation de Firebase:', error);
}

module.exports = admin;