// src/config/logger.js
// SYSTEME DE LOGS CENTRALISE - Masquage PII (RGPD Compliant) & Sentry Integration
// STANDARD: Industriel / Bank Grade

const winston = require('winston');
const path = require('path');
const Sentry = require('@sentry/node');
const { env } = require('./env');

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

// CORRECTION : Creation d'un vrai Transport Winston personnalise au lieu d'un faux Stream
class CustomSentryTransport extends winston.Transport {
  constructor(opts) {
    super(opts);
  }

  log(info, callback) {
    setImmediate(() => {
      this.emit('logged', info);
    });

    if (info.level === 'error') {
      Sentry.captureException(new Error(info.message), {
        extra: info
      });
    }
    
    if (callback) {
      callback();
    }
  }
}

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

const transportsList = [
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
  })
];

if (process.env.SENTRY_DSN) {
  transportsList.push(new CustomSentryTransport({ level: 'error' }));
}

const logger = winston.createLogger({
  level: env.NODE_ENV === 'development' ? 'debug' : 'info',
  levels,
  format: baseFormat,
  transports: transportsList,
  exceptionHandlers: [
    new winston.transports.Console({ format: consoleFormat }),
    new winston.transports.File({ filename: path.join('logs', 'exceptions.log') })
  ],
  rejectionHandlers: [
    new winston.transports.Console({ format: consoleFormat }),
    new winston.transports.File({ filename: path.join('logs', 'rejections.log') })
  ],
  exitOnError: false 
});

module.exports = logger;