// src/config/logger.js
// SYSTÈME DE LOGS CENTRALISÉ - Masquage PII & Rotation
// CSCSM Level: Bank Grade

const winston = require('winston');
const path = require('path');
const { env } = require('./env');

// 🛡️ Liste des champs sensibles à masquer
const SENSITIVE_FIELDS = ['password', 'token', 'accessToken', 'refreshToken', 'currentPassword', 'newPassword'];

/**
 * Format de masquage (Redaction)
 * Remplace les valeurs sensibles par [MASKED] dans les logs
 */
const redactFormat = winston.format((info) => {
  const mask = (obj) => {
    for (const key in obj) {
      if (SENSITIVE_FIELDS.includes(key)) {
        obj[key] = '[MASKED]';
      } else if (typeof obj[key] === 'object' && obj[key] !== null) {
        mask(obj[key]);
      }
    }
  };

  if (info.message && typeof info.message === 'object') {
    mask(info.message);
  }
  return info;
});

const levels = { error: 0, warn: 1, info: 2, http: 3, debug: 4 };
const colors = { error: 'red', warn: 'yellow', info: 'green', http: 'magenta', debug: 'white' };
winston.addColors(colors);

const baseFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  redactFormat(), // Application du masquage avant l'écriture
  winston.format.errors({ stack: true }), // Capture les stack traces proprement
  winston.format.json() // Format JSON pour une meilleure analyse (Datadog/ELK)
);

const consoleFormat = winston.format.combine(
  winston.format.colorize({ all: true }),
  winston.format.printf((info) => `${info.timestamp} ${info.level}: ${info.message}${info.stack ? '\n' + info.stack : ''}`)
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