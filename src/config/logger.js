// src/config/logger.js
// SYSTÈME DE LOGS CENTRALISÉ - Masquage PII (RGPD Compliant) & Stack Traces
// CSCSM Level: Bank Grade

const winston = require('winston');
const path = require('path');
const { env } = require('./env');

// 🛡️ SÉCURITÉ RGPD & PCI-DSS : Liste des champs sensibles (Credentials + PII)
const SENSITIVE_FIELDS = [
  'password', 'token', 'accessToken', 'refreshToken', 'currentPassword', 'newPassword',
  'email', 'phone', 'idCard', 'license', 'insurance', 'fcmToken' // 🚨 Ajout des PII Critiques
];

/**
 * Format de masquage (Redaction)
 * Remplace rigoureusement les valeurs sensibles par [MASKED] dans les logs
 */
const redactFormat = winston.format((info) => {
  const mask = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    for (const key in obj) {
      if (SENSITIVE_FIELDS.includes(key)) {
        obj[key] = '[MASKED]';
      } else if (typeof obj[key] === 'object' && obj[key] !== null) {
        mask(obj[key]);
      }
    }
  };

  // Masquage du message principal s'il s'agit d'un objet JSON
  if (info.message && typeof info.message === 'object') {
    mask(info.message);
  }
  
  // Masquage des métadonnées injectées (comme des requêtes brutes ou objets DB)
  for (const sym of Object.getOwnPropertySymbols(info)) {
    if (typeof info[sym] === 'object') {
      mask(info[sym]);
    }
  }

  return info;
});

const levels = { error: 0, warn: 1, info: 2, http: 3, debug: 4 };
const colors = { error: 'red', warn: 'yellow', info: 'green', http: 'magenta', debug: 'white' };
winston.addColors(colors);

const baseFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.errors({ stack: true }), // 🚀 Doit être placé AVANT JSON pour extraire la stack proprement
  redactFormat(), // Application du masquage avant formatage final
  winston.format.json() // Format JSON pour une meilleure analyse (Datadog/ELK)
);

const consoleFormat = winston.format.combine(
  winston.format.colorize({ all: true }),
  winston.format.printf((info) => {
    const stackInfo = info.stack ? `\n${info.stack}` : '';
    return `${info.timestamp} ${info.level}: ${info.message}${stackInfo}`;
  })
);

const logger = winston.createLogger({
  level: env.NODE_ENV === 'development' ? 'debug' : 'info',
  levels,
  format: baseFormat,
  transports: [
    new winston.transports.Console({ format: consoleFormat }),
    // Fichier Erreurs (Rotation gérée par maxsize/maxFiles)
    new winston.transports.File({
      filename: path.join('logs', 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: path.join('logs', 'all.log'),
      maxsize: 10485760, // 10MB
      maxFiles: 7,
    }),
  ],
});

module.exports = logger;