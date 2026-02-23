// src/utils/constants.js
// CONSTANTES GLOBALES YÉLY - Centralisées pour audit & maintenabilité 10+ ans
// CSCSM Level: Bank Grade

const CONSTANTS = {
  // Rôles (identiques aux modèles existants)
  ROLES: {
    RIDER: 'rider',
    DRIVER: 'driver',
    ADMIN: 'admin',
    SUPER_ADMIN: 'superadmin'
  },

  // Statuts de course (séquentiel strict comme dans le cahier)
  RIDE_STATUSES: {
    PENDING: 'pending',
    ACCEPTED: 'accepted',
    DRIVER_ARRIVED: 'driver_arrived',
    ONGOING: 'ongoing',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled',
    REFUSED: 'refused'
  },

  // Statuts abonnement
  SUBSCRIPTION_STATUSES: {
    PENDING: 'pending',
    ACTIVE: 'active',
    EXPIRED: 'expired',
    REJECTED: 'rejected'
  },

  // Types de transactions
  TRANSACTION_TYPES: {
    SUBSCRIPTION_WEEKLY: 'subscription_weekly',
    SUBSCRIPTION_MONTHLY: 'subscription_monthly',
    RIDE_PAYMENT: 'ride_payment'
  },

  // Sécurité GPS & Socket (déjà présent dans server.js → centralisé ici)
  MAX_SPOOF_STRIKES: 3,
  LOCATION_UPDATE_RATE_MS: 1000,
  MAX_SPEED_KMH_SPOOF: 200,

  // Cloudinary (déjà utilisé)
  CLOUDINARY_FOLDERS: {
    PROOFS: 'yely/proofs',
    PROFILES: 'yely/profiles',
    CARS: 'yely/cars'
  },

  // Codes HTTP (pas de magic numbers)
  HTTP_STATUS: {
    OK: 200,
    CREATED: 201,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    CONFLICT: 409,
    TOO_MANY_REQUESTS: 429,
    INTERNAL_SERVER_ERROR: 500
  }
};

module.exports = CONSTANTS;