// src/services/geniusPayService.js
// SERVICE PASSERELLE GENIUSPAY - Orchestration API & Sécurité Cryptographique
// STANDARD: Industriel / Bank Grade (HMAC-SHA256, Idempotence & Timing-Safe)

const axios = require('axios');
const crypto = require('crypto');
const logger = require('../config/logger');
const AppError = require('../utils/AppError');

class GeniusPayService {
  constructor() {
    this.baseUrl = process.env.GENIUSPAY_BASE_URL || 'https://geniuspay.ci/api/v1/merchant';
    this.apiKey = process.env.GENIUSPAY_API_KEY || '';
    this.apiSecret = process.env.GENIUSPAY_API_SECRET || '';
    this.webhookSecret = process.env.GENIUSPAY_WEBHOOK_SECRET || this.apiSecret;
  }

  /**
   * Retourne les en-têtes HTTP authentifiés pour GeniusPay
   */
  _getHeaders() {
    return {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-API-Key': this.apiKey,
      'Authorization': `Bearer ${this.apiKey}`
    };
  }

  /**
   * Initialise une session de paiement sécurisée auprès de GeniusPay
   * @param {Object} params - Données de la commande
   * @returns {Promise<Object>} Données de la session incluant l'URL de paiement
   */
  async createPaymentSession({ amount, reference, customer, description, returnUrl, callbackUrl, metadata = {} }) {
    if (!this.apiKey) {
      logger.error('[GENIUSPAY] Clé API manquante dans la configuration serveur.');
      throw new AppError('Configuration du service de paiement indisponible.', 500);
    }

    const payload = {
      amount: Number(amount),
      currency: 'XOF',
      reference: reference,
      description: description || 'Abonnement Yély',
      customer: {
        name: customer?.name || 'Utilisateur Yély',
        email: customer?.email || 'client@yely.ci',
        phone: customer?.phone || ''
      },
      return_url: returnUrl,
      callback_url: callbackUrl || `${process.env.BACKEND_URL || 'https://yely-backend-yzw4.onrender.com'}/api/subscriptions/webhook`,
      metadata: {
        ...metadata,
        platform: 'YELY_APP',
        timestamp: Date.now()
      }
    };

    try {
      logger.info(`[GENIUSPAY] Initialisation paiement pour ref: ${reference} (${amount} XOF)`);
      
      const response = await axios.post(`${this.baseUrl}/payments`, payload, {
        headers: this._getHeaders(),
        timeout: 15000 // 15 secondes max
      });

      const data = response.data?.data || response.data;
      
      // Extraction de l'URL de paiement retournée par GeniusPay
      const paymentUrl = data.payment_url || data.checkout_url || data.url || data.link;

      if (!paymentUrl) {
        logger.error(`[GENIUSPAY_ERROR] URL de paiement absente de la réponse : ${JSON.stringify(response.data)}`);
        throw new AppError('Impossible de générer le lien de paiement.', 502);
      }

      return {
        paymentUrl,
        reference: reference,
        gatewayTransactionId: data.id || data.transaction_id || null,
        raw: data
      };
    } catch (error) {
      const errorMsg = error.response?.data?.message || error.message;
      logger.error(`[GENIUSPAY_INIT_ERROR] Échec initialisation : ${errorMsg}`, {
        response: error.response?.data
      });
      throw new AppError(
        error.response?.data?.message || 'Erreur lors de l’initialisation de la passerelle de paiement.',
        error.response?.status || 502
      );
    }
  }

  /**
   * Vérifie la signature cryptographique HMAC-SHA256 du Webhook GeniusPay
   * @param {string} signature - Header X-Webhook-Signature
   * @param {string|number} timestamp - Header X-Webhook-Timestamp
   * @param {string|Buffer} rawBody - Corps brut de la requête (Raw Payload)
   * @returns {boolean} Vrai si la signature est 100% authentique
   */
  verifyWebhookSignature(signature, timestamp, rawBody) {
    const secret = this.webhookSecret || this.apiSecret;

    if (!secret || !signature || !timestamp || !rawBody) {
      logger.warn('[GENIUSPAY_WEBHOOK] Données de signature incomplètes pour vérification.');
      return false;
    }

    try {
      const payloadString = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
      const dataToSign = `${timestamp}.${payloadString}`;

      const computedSignature = crypto
        .createHmac('sha256', secret)
        .update(dataToSign)
        .digest('hex');

      // Comparaison en temps constant (Timing-Safe) contre les attaques de timing
      const signatureBuffer = Buffer.from(signature, 'hex');
      const computedBuffer = Buffer.from(computedSignature, 'hex');

      if (signatureBuffer.length !== computedBuffer.length) {
        return false;
      }

      return crypto.timingSafeEqual(signatureBuffer, computedBuffer);
    } catch (err) {
      logger.error(`[GENIUSPAY_VERIFY_ERROR] Erreur vérification signature : ${err.message}`);
      return false;
    }
  }

  /**
   * Vérifie le statut réel d'une transaction auprès de GeniusPay
   * @param {string} referenceOrId - Référence Yély ou ID transaction GeniusPay
   */
  async checkPaymentStatus(referenceOrId) {
    try {
      const response = await axios.get(`${this.baseUrl}/payments/${referenceOrId}`, {
        headers: this._getHeaders(),
        timeout: 10000
      });
      return response.data?.data || response.data;
    } catch (error) {
      logger.error(`[GENIUSPAY_CHECK_ERROR] Échec interrogation statut (${referenceOrId}): ${error.message}`);
      return null;
    }
  }
}

module.exports = new GeniusPayService();
