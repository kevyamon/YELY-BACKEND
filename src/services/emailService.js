const axios = require('axios');
const nodemailer = require('nodemailer');
const logger = require('../config/logger');

const sendViaBrevoApi = async ({ to, subject, html, text }) => {
  const brevoApiKey = process.env.BREVO_API_KEY;
  if (!brevoApiKey) return false;

  const senderEmail = process.env.EMAIL_FROM || 'yelyinfos@gmail.com';
  const senderName = 'Yély Service';

  try {
    await axios.post(
      'https://api.brevo.com/v3/smtp/email',
      {
        sender: { email: senderEmail, name: senderName },
        to: [{ email: to }],
        subject,
        htmlContent: html,
        textContent: text || undefined,
      },
      {
        headers: {
          accept: 'application/json',
          'api-key': brevoApiKey,
          'content-type': 'application/json',
        },
      }
    );
    logger.info(`[BREVO API] Email envoyé avec succès à ${to} | Sujet: ${subject}`);
    return true;
  } catch (error) {
    const errorDetails = error.response ? JSON.stringify(error.response.data) : error.message;
    logger.error(`[BREVO API ERROR] Destinataire: ${to} | Erreur: ${errorDetails}`);
    return false;
  }
};

const sendMail = async ({ to, subject, html, text }) => {
  try {
    // 1. Priorité API REST Brevo (utilisée par le projet pour bypasser les pare-feux Cloud)
    const sentByBrevo = await sendViaBrevoApi({ to, subject, html, text });
    if (sentByBrevo) return { success: true, provider: 'brevo_api' };

    // 2. Fallback SMTP Nodemailer
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    if (user && pass) {
      const host = process.env.SMTP_HOST || 'smtp-relay.brevo.com';
      const port = parseInt(process.env.SMTP_PORT, 10) || 587;
      const transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
      });
      const info = await transporter.sendMail({
        from: process.env.EMAIL_FROM || 'Yély <yelyinfos@gmail.com>',
        to,
        subject,
        text: text || '',
        html,
      });
      logger.info(`[SMTP] Email envoyé via SMTP à ${to}`);
      return info;
    }

    logger.info(`[SIMULATION EMAIL] A: ${to} | Sujet: ${subject}`);
    return { simulated: true };
  } catch (error) {
    logger.error(`[EMAIL ERREUR] Destinataire: ${to} | Erreur: ${error.message}`);
    return null;
  }
};

/**
 * Notifie le superadministrateur lorsqu'un chauffeur soumet ses pièces d'identité
 */
const sendIdentitySubmittedToAdmin = async (adminEmail, adminName, driverData) => {
  const subject = `[YÉLY] Nouvelle demande de vérification d'identité - ${driverData.name || 'Chauffeur'}`;
  
  const vehicleText = driverData.vehicle?.type
    ? `${(driverData.vehicle.type || '').toUpperCase()} (${driverData.vehicle.model || 'Modèle non précisé'} - ${driverData.vehicle.plate || 'Non immatriculé'})`
    : 'Non spécifié';

  const html = `
    <div style="font-family: Arial, sans-serif; background-color: #121418; color: #FFFFFF; padding: 24px; border-radius: 12px; max-width: 600px; margin: auto;">
      <div style="text-align: center; margin-bottom: 20px;">
        <h1 style="color: #D4AF37; margin: 0; font-size: 24px;">YÉLY ADMINISTRATION</h1>
        <p style="color: #A0A0A0; font-size: 14px;">Nouvelle soumission de documents d'identité</p>
      </div>
      <div style="background-color: #1A1D24; padding: 20px; border-radius: 8px; border: 1px solid rgba(212, 175, 55, 0.2); margin-bottom: 20px;">
        <h3 style="color: #D4AF37; margin-top: 0;">Détails du chauffeur :</h3>
        <p style="margin: 6px 0;"><strong>Nom :</strong> ${driverData.name || 'Non renseigné'}</p>
        <p style="margin: 6px 0;"><strong>Téléphone :</strong> ${driverData.phone || 'Non renseigné'}</p>
        <p style="margin: 6px 0;"><strong>Email :</strong> ${driverData.email || 'Non renseigné'}</p>
        <p style="margin: 6px 0;"><strong>Véhicule :</strong> ${vehicleText}</p>
      </div>
      <p style="font-size: 14px; color: #CCCCCC; line-height: 1.5;">
        Veuillez vous connecter sur le panneau d'administration de l'application Yély dans la section <strong>Vérifications ID</strong> pour examiner les pièces fournies (recto / verso) et valider ou rejeter le dossier.
      </p>
      <div style="text-align: center; margin-top: 24px;">
        <a href="${process.env.FRONTEND_URL || 'https://yely-amber.vercel.app'}" style="background-color: #D4AF37; color: #121418; padding: 12px 24px; text-decoration: none; font-weight: bold; border-radius: 6px; display: inline-block;">Accéder au panneau d'administration</a>
      </div>
      <div style="text-align: center; margin-top: 30px; font-size: 12px; color: #666666;">
        <p>© ${new Date().getFullYear()} Yély Technologies. Tous droits réservés.</p>
      </div>
    </div>
  `;

  return sendMail({ to: adminEmail, subject, html });
};

/**
 * Notifie le chauffeur de la décision d'approbation ou de rejet de son dossier d'identité
 */
const sendIdentityDecisionToDriver = async (driverEmail, driverName, decision, reason = '') => {
  if (!driverEmail) return null;

  const isApproved = decision === 'approved';
  const subject = isApproved
    ? '[YÉLY] Félicitations ! Votre identité a été validée avec succès'
    : '[YÉLY] Information concernant votre dossier de vérification d\'identité';

  const html = `
    <div style="font-family: Arial, sans-serif; background-color: #121418; color: #FFFFFF; padding: 24px; border-radius: 12px; max-width: 600px; margin: auto;">
      <div style="text-align: center; margin-bottom: 20px;">
        <h1 style="color: #D4AF37; margin: 0; font-size: 24px;">YÉLY</h1>
        <p style="color: #A0A0A0; font-size: 14px;">Service Chauffeur & VTC</p>
      </div>
      <div style="background-color: #1A1D24; padding: 20px; border-radius: 8px; border: 1px solid ${isApproved ? 'rgba(74, 222, 128, 0.3)' : 'rgba(239, 68, 68, 0.3)'}; margin-bottom: 20px;">
        <h2 style="color: ${isApproved ? '#4ADE80' : '#EF4444'}; margin-top: 0; font-size: 18px;">
          ${isApproved ? 'Dossier d\'identité approuvé' : 'Dossier d\'identité refusé'}
        </h2>
        <p style="font-size: 15px; line-height: 1.5; color: #E5E7EB;">
          Bonjour <strong>${driverName || 'Chauffeur'}</strong>,
        </p>
        <p style="font-size: 15px; line-height: 1.5; color: #E5E7EB;">
          ${isApproved
            ? 'Votre dossier de vérification d\'identité et de votre véhicule a été validé par l\'administration de Yély. Vous pouvez dès à présent ouvrir votre application, passer en ligne et commencer à recevoir des courses.'
            : `Votre dossier de vérification d'identité n'a pas pu être validé pour la raison suivante :<br><br><span style="color: #FCA5A5; font-style: italic;">« ${reason || 'Documents non conformes ou illisibles'} »</span>.<br><br>Vous pouvez soumettre à nouveau vos pièces d'identité depuis la section Profil de votre application.`}
        </p>
      </div>
      <div style="text-align: center; margin-top: 24px;">
        <a href="${process.env.FRONTEND_URL || 'https://yely-amber.vercel.app'}" style="background-color: #D4AF37; color: #121418; padding: 12px 24px; text-decoration: none; font-weight: bold; border-radius: 6px; display: inline-block;">Ouvrir l'application Yély</a>
      </div>
      <div style="text-align: center; margin-top: 30px; font-size: 12px; color: #666666;">
        <p>© ${new Date().getFullYear()} Yély Technologies. Tous droits réservés.</p>
      </div>
    </div>
  `;

  return sendMail({ to: driverEmail, subject, html });
};

module.exports = {
  sendMail,
  sendIdentitySubmittedToAdmin,
  sendIdentityDecisionToDriver,
};
