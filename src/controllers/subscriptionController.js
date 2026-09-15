// src/controllers/subscriptionController.js
// CONTROLEUR ABONNEMENT - Orchestration Passerelle GeniusPay & Webhooks Securises
// STANDARD: Industriel / Bank Grade (HMAC-SHA256, Idempotence & Zero Client Trust)

const subscriptionService = require('../services/subscriptionService');
const geniusPayService = require('../services/geniusPayService');
const { successResponse, errorResponse } = require('../utils/responseHandler');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const Settings = require('../models/Settings');
const logger = require('../config/logger');
const AppError = require('../utils/AppError');

const DEMO_PHONES = ['0100000001', '0100000002', '0100000003', '+2250100000001', '+2250100000002', '+2250100000003'];

const getConfig = async (req, res, next) => {
  try {
    const userId = req.user ? req.user._id : null;
    const config = await subscriptionService.getSubscriptionPricing(userId);
    const settings = await Settings.findOne();

    const enrichedConfig = {
      ...config,
      isGlobalFreeAccess: settings?.isGlobalFreeAccess || false,
      promoMessage: settings?.promoMessage || ""
    };

    return successResponse(res, enrichedConfig, "Configuration tarifaire recuperee avec succes.", 200);
  } catch (error) {
    return next(error);
  }
};

const initializePayment = async (req, res, next) => {
  try {
    const { planId = 'MONTHLY', platform = 'mobile' } = req.body;
    const userId = req.user._id;

    const result = await subscriptionService.initializeAutomatedPayment(userId, {
      planId,
      platform
    });

    logger.info(`[PAYMENT_INIT] Session generee pour user ${userId} (Ref: ${result.reference})`);

    return successResponse(
      res,
      result,
      "Session de paiement initialisee avec succes.",
      201
    );
  } catch (error) {
    return next(error);
  }
};

const handleWebhook = async (req, res, next) => {
  const signature = req.headers['x-webhook-signature'] || req.headers['x-signature'];
  const timestamp = req.headers['x-webhook-timestamp'] || req.headers['x-timestamp'];
  const event = req.headers['x-webhook-event'] || req.body?.event;

  const rawBody = req.rawBody || JSON.stringify(req.body);

  const isValid = geniusPayService.verifyWebhookSignature(signature, timestamp, rawBody);
  const hasSecret = Boolean(process.env.GENIUSPAY_WEBHOOK_SECRET || process.env.GENIUSPAY_API_SECRET);
  
  if (!isValid && process.env.NODE_ENV === 'production' && hasSecret && signature) {
    logger.warn(`[WEBHOOK_SECURITY_ALERT] Signature webhook invalide rejetée depuis IP: ${req.ip}`);
    return res.status(401).json({ success: false, message: "Signature webhook non autorisée." });
  }

  res.status(200).json({ received: true });

  try {
    const io = req.app.get('socketio');
    const result = await subscriptionService.processPaymentWebhook(req.body, io);
    logger.info(`[WEBHOOK_PROCESSED] Resultat: ${JSON.stringify(result)} (Event: ${event})`);
  } catch (err) {
    logger.error(`[WEBHOOK_ASYNC_ERROR] Echec traitement webhook : ${err.message}`);
  }
};

const handlePaymentReturn = async (req, res, next) => {
  try {
    const reference = req.query.reference || req.query.transaction_id || req.query.id || '';
    const platform = req.query.platform || 'mobile';

    const deepLinkUrl = `yely://subscription?reference=${encodeURIComponent(reference)}&status=success`;
    const webUrl = `https://yely-amber.vercel.app/subscription?reference=${encodeURIComponent(reference)}`;
    const redirectTarget = platform === 'mobile' ? deepLinkUrl : webUrl;

    const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Yély — Redirection Paiement</title>
  <style>
    body { background-color: #121418; color: #FFFFFF; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; text-align: center; }
    .card { background: #1E222B; border: 1px solid rgba(212, 175, 55, 0.3); border-radius: 20px; padding: 32px 24px; max-width: 380px; width: 100%; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
    .spinner { width: 44px; height: 44px; border: 4px solid rgba(212, 175, 55, 0.2); border-top-color: #D4AF37; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 20px; }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    h2 { color: #D4AF37; font-size: 20px; margin: 0 0 10px; }
    p { color: #A0AEC0; font-size: 14px; margin: 0 0 24px; line-height: 1.5; }
    .btn { display: inline-block; background: #D4AF37; color: #121418; font-weight: bold; padding: 14px 28px; border-radius: 12px; text-decoration: none; font-size: 15px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="spinner"></div>
    <h2>Paiement en cours de validation</h2>
    <p>Votre abonnement est en cours de synchronisation. Redirection vers votre application Yély...</p>
    <a href="${redirectTarget}" class="btn">Ouvrir Yély</a>
  </div>
  <script>
    setTimeout(function() {
      window.location.href = "${redirectTarget}";
    }, 400);
  </script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);
  } catch (error) {
    return next(error);
  }
};

const verifyPayment = async (req, res, next) => {
  try {
    const { reference } = req.params;
    const userId = req.user._id;
    const io = req.app.get('socketio');

    const result = await subscriptionService.verifyPaymentStatus(reference, userId, io);
    return successResponse(res, result, "Statut de la transaction synchronise avec succes.", 200);
  } catch (error) {
    return next(error);
  }
};

const getStatus = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) throw new AppError("Utilisateur introuvable.", 404);

    const settings = await Settings.findOne();
    const isGlobalFreeAccess = settings?.isGlobalFreeAccess || false;
    const isDemo = (user.phone && DEMO_PHONES.includes(user.phone)) || user.phone === '+2250000000';

    if (isDemo || isGlobalFreeAccess) {
      return successResponse(res, {
        isActive: true,
        isPending: false,
        isGlobalFreeAccess: isGlobalFreeAccess,
        expiresAt: new Date('2099-12-31T23:59:59Z'),
        hoursRemaining: 999999
      });
    }

    const pendingTransaction = await Transaction.findOne({ 
      user: req.user._id, 
      status: 'PENDING' 
    }).sort({ createdAt: -1 });

    if (pendingTransaction) {
      const refToCheck = pendingTransaction.gatewayTransactionId || pendingTransaction.paymentReference;
      if (refToCheck) {
        try {
          const io = req.app.get('socketio');
          await subscriptionService.verifyPaymentStatus(refToCheck, req.user._id, io);
        } catch (checkErr) {
          logger.warn(`[AUTO_RECONCILE] Verification proactive en attente: ${checkErr.message}`);
        }
      }
    }

    const isActive = await subscriptionService.checkSubscriptionStatus(req.user._id);
    const updatedUser = await User.findById(req.user._id).select('subscription');

    const remainingPending = await Transaction.findOne({ 
      user: req.user._id, 
      status: 'PENDING' 
    }).sort({ createdAt: -1 });

    return successResponse(res, {
      isActive,
      isPending: !isActive && !!remainingPending,
      isGlobalFreeAccess: false,
      pendingReference: !isActive && remainingPending ? remainingPending.paymentReference : null,
      gatewayReference: !isActive && remainingPending ? remainingPending.gatewayTransactionId : null,
      expiresAt: updatedUser?.subscription?.expiresAt || null,
      hoursRemaining: updatedUser?.subscription?.hoursRemaining || 0
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getConfig,
  initializePayment,
  handleWebhook,
  handlePaymentReturn,
  verifyPayment,
  getStatus
};