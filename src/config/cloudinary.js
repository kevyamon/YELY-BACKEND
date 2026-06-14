// src/config/cloudinary.js
// DUAL-PORT/MULTI-STORAGE CLOUDINARY CONFIGURATION - Auto-switching Fallback Chain (Smart Cursor)
// CSCSM Level: Bank Grade / Failover High-Availability

const cloudinary = require('cloudinary').v2;
const logger = require('./logger');

// Scan and initialize all configured Cloudinary instances
const configs = [];

// 1. First account (mandatory default config)
if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
  configs.push({
    index: 1,
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME.trim(),
    api_key: process.env.CLOUDINARY_API_KEY.trim(),
    api_secret: process.env.CLOUDINARY_API_SECRET.trim()
  });
}

// 2. Scan dynamically for secondary accounts (up to index 1000)
for (let i = 2; i <= 1000; i++) {
  const cloudName = process.env[`CLOUDINARY_CLOUD_NAME_${i}`];
  const apiKey = process.env[`CLOUDINARY_API_KEY_${i}`];
  const apiSecret = process.env[`CLOUDINARY_API_SECRET_${i}`];

  if (cloudName && apiKey && apiSecret) {
    configs.push({
      index: i,
      cloud_name: cloudName.trim(),
      api_key: apiKey.trim(),
      api_secret: apiSecret.trim()
    });
  }
}

logger.info(`[CLOUDINARY] ${configs.length} instance(s) de stockage detectee(s).`);

// "Smart Cursor" mémorisant l'index de la première instance fonctionnelle connue
let currentActiveIndex = 0;

// Wrapper drop-in replacement simulating v2 API
const multiCloudinary = {
  // Expose the raw instance so client code can access direct properties if needed
  raw: cloudinary,
  
  config: (options) => {
    // If client code calls .config(), we delegate it to the main library
    cloudinary.config(options);
  },

  uploader: {
    upload: async (file, options = {}) => {
      if (configs.length === 0) {
        throw new Error("Aucune instance Cloudinary n'est configuree.");
      }

      let lastError = null;

      // Commencer la recherche à partir du Smart Cursor (évite de retenter les instances saturées)
      for (let i = currentActiveIndex; i < configs.length; i++) {
        const config = configs[i];
        try {
          cloudinary.config({
            cloud_name: config.cloud_name,
            api_key: config.api_key,
            api_secret: config.api_secret,
            secure: true
          });

          const result = await cloudinary.uploader.upload(file, options);
          
          // Inject the active cloud name in the result for tracking/debugging
          result.cloud_name = config.cloud_name;
          
          // Si on a dû avancer dans le tableau, on fige le Smart Cursor sur cette instance fonctionnelle
          if (i !== currentActiveIndex) {
            currentActiveIndex = i;
            logger.info(`[CLOUDINARY] Smart Cursor deplace definitivement vers l'instance #${config.index} (${config.cloud_name})`);
          }

          logger.info(`[CLOUDINARY] Upload reussi sur l'instance #${config.index} (${config.cloud_name})`);
          return result;
        } catch (err) {
          logger.warn(`[CLOUDINARY] Echec upload sur l'instance #${config.index} (${config.cloud_name}): ${err.message}. Basculement...`);
          lastError = err;
        }
      }

      // Filet de sécurité : Si le curseur a été déplacé mais que toutes les instances suivantes échouent également,
      // on tente un reset temporaire du curseur pour revérifier les premières instances (au cas où du stockage s'est libéré).
      if (currentActiveIndex > 0) {
        logger.info("[CLOUDINARY] Re-tentative globale : Reset temporaire du Smart Cursor vers l'instance 1.");
        for (let i = 0; i < currentActiveIndex; i++) {
          const config = configs[i];
          try {
            cloudinary.config({
              cloud_name: config.cloud_name,
              api_key: config.api_key,
              api_secret: config.api_secret,
              secure: true
            });

            const result = await cloudinary.uploader.upload(file, options);
            result.cloud_name = config.cloud_name;
            currentActiveIndex = i; // Reset permanent vers cette instance libérée
            logger.info(`[CLOUDINARY] Smart Cursor re-positionne vers l'instance #${config.index} (${config.cloud_name})`);
            return result;
          } catch (err) {
            lastError = err;
          }
        }
      }

      throw lastError || new Error("Aucun stockage Cloudinary disponible pour completer l'upload.");
    },

    destroy: async (publicId, options = {}) => {
      let lastResult = null;
      let errors = [];

      // We attempt to delete it on ALL configured accounts to ensure complete clean up
      for (const config of configs) {
        try {
          cloudinary.config({
            cloud_name: config.cloud_name,
            api_key: config.api_key,
            api_secret: config.api_secret,
            secure: true
          });

          const result = await cloudinary.uploader.destroy(publicId, options);
          lastResult = result;
        } catch (err) {
          errors.push(`${config.cloud_name}: ${err.message}`);
        }
      }

      if (errors.length === configs.length && configs.length > 0) {
        logger.error(`[CLOUDINARY] Erreur de suppression sur toutes les instances : ${errors.join(' | ')}`);
      }

      return lastResult || { result: 'not_found' };
    }
  }
};

module.exports = multiCloudinary;