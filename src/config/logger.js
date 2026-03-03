// src/config/logger.js
// SYSTEME DE LOGS CENTRALISE - Masquage PII (RGPD Compliant) & Stack Traces
// STANDARD: Industriel / Bank Grade

const winston = require('winston');
const path = require('path');
const { env } = require('./env');

// SECURITE RGPD & PCI-DSS : Liste des champs sensibles (Credentials + PII)
const SENSITIVE_FIELDS = [
  'password', 'token', 'accessToken', 'refreshToken', 'currentPassword', 'newPassword',
  'email', 'phone', 'idCard', 'license', 'insurance', 'fcmToken' 
];

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

  if (info.message && typeof info.message === 'object') {
    mask(info.message);
  }
  
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
  winston.format.errors({ stack: true }), 
  redactFormat(), 
  winston.format.json() 
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
    new winston.transports.File({
      filename: path.join('logs', 'error.log'),
      level: 'error',
      maxsize: 5242880, 
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: path.join('logs', 'all.log'),
      maxsize: 10485760, 
      maxFiles: 7,
    }),
  ],
  // CAPTURE DES CRASHS FATALS (Nouveau filet de securite)
  exceptionHandlers: [
    new winston.transports.Console({ format: consoleFormat }),
    new winston.transports.File({ filename: path.join('logs', 'exceptions.log') })
  ],
  rejectionHandlers: [
    new winston.transports.Console({ format: consoleFormat }),
    new winston.transports.File({ filename: path.join('logs', 'rejections.log') })
  ],
  exitOnError: false // Permet a Winston de loguer l'erreur avant que le processus ne soit tue
});

module.exports = logger;