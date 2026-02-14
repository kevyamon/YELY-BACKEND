// src/config/logger.js
// SYSTÈME DE LOGS CENTRALISÉ (WINSTON)
// CSCSM Level: Bank Grade

const winston = require('winston');
const path = require('path');
const { env } = require('./env');

// Formats personnalisés
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
};

winston.addColors(colors);

const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.printf(
    (info) => `${info.timestamp} ${info.level}: ${info.message}`,
  ),
);

// Transports (Sorties)
const transports = [
  // 1. Console (développement & production pour logs temps réel)
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize({ all: true }),
      format
    ),
  }),
  // 2. Fichier Erreurs (Persistance)
  new winston.transports.File({
    filename: path.join('logs', 'error.log'),
    level: 'error',
    maxsize: 5242880, // 5MB
    maxFiles: 5,
  }),
  // 3. Fichier Global
  new winston.transports.File({
    filename: path.join('logs', 'all.log'),
    maxsize: 5242880, // 5MB
    maxFiles: 5,
  }),
];

const logger = winston.createLogger({
  level: env.NODE_ENV === 'development' ? 'debug' : 'info',
  levels,
  transports,
});

module.exports = logger;