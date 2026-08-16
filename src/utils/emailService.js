// src/utils/emailService.js
// SERVICE D'ENVOI D'EMAILS - Connecteur API REST Brevo (Contournement Pare-feu Cloud)
// CSCSM Level: Bank Grade

const axios = require('axios');

const LOGO_URL = "https://res.cloudinary.com/dskdkrwhq/image/upload/v1772629185/photo_2026-03-04_12-55-42_b9icek.jpg";
const GOLD_COLOR = "#D4AF37";

const sendOtpEmail = async (to, otp) => {
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <body style="margin: 0; padding: 0; background-color: #0F0F0F; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;">
      <table width="100%" border="0" cellspacing="0" cellpadding="0">
        <tr>
          <td align="center" style="padding: 40px 0;">
            <div style="max-width: 500px; width: 90%; background-color: #1A1A1A; border: 1px solid #333; border-radius: 20px; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.5);">
              
              <div style="padding: 30px; text-align: center; background: #000;">
                <img src="${LOGO_URL}" alt="Yely Logo" width="120" style="display: block; margin: 0 auto; border-radius: 10px;">
              </div>

              <div style="padding: 40px 30px; text-align: center;">
                <h1 style="color: #FFFFFF; font-size: 24px; margin-bottom: 10px; font-weight: 300;">Réinitialisation</h1>
                <p style="color: #AAAAAA; font-size: 16px; line-height: 24px; margin-bottom: 30px;">
                  Entrez le code sécurisé ci-dessous dans l'application pour modifier votre mot de passe :
                </p>

                <div style="display: inline-block; padding: 20px 40px; background-color: #000000; border: 2px solid ${GOLD_COLOR}; border-radius: 12px; margin-bottom: 30px;">
                  <span style="font-size: 38px; font-weight: bold; letter-spacing: 10px; color: ${GOLD_COLOR};">
                    ${otp}
                  </span>
                </div>

                <p style="color: #666666; font-size: 12px;">
                  Ce code est valable 15 minutes. Si vous n'êtes pas à l'origine de cette demande, ignorez ce mail.
                </p>
              </div>

              <div style="background-color: #111111; padding: 20px; text-align: center; border-top: 1px solid #333;">
                <p style="color: #444444; font-size: 11px; margin: 0;">© 2026 Yely Tech Team. Tous droits réservés.</p>
              </div>
            </div>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  try {
    await axios.post(
      'https://api.brevo.com/v3/smtp/email',
      {
        sender: { email: process.env.EMAIL_FROM, name: "Yely Support" },
        to: [{ email: to }],
        subject: `Code de securite Yely: ${otp}`,
        htmlContent: htmlContent
      },
      {
        headers: {
          'accept': 'application/json',
          'api-key': process.env.BREVO_API_KEY,
          'content-type': 'application/json'
        }
      }
    );
    return true;
  } catch (error) {
    const errorDetails = error.response ? JSON.stringify(error.response.data) : error.message;
    console.error("[EMAIL ERROR] Echec d'envoi API HTTP :", errorDetails);
    throw new Error("Impossible d'envoyer l'email.");
  }
};

const sendAdminAlert = async (subject, textContent) => {
  try {
    const adminEmail = process.env.ADMIN_EMAIL || "yelyinfos@gmail.com";
    
    if (!adminEmail) {
      console.warn("[EMAIL WARN] ADMIN_EMAIL non defini. Alerte non envoyee.");
      return false;
    }

    await axios.post(
      'https://api.brevo.com/v3/smtp/email',
      {
        sender: { email: process.env.EMAIL_FROM || "noreply@yely.app", name: "Yely System Alert" },
        to: [{ email: adminEmail }],
        subject: `ALERTE SYSTEME : ${subject}`,
        textContent: textContent
      },
      {
        headers: {
          'accept': 'application/json',
          'api-key': process.env.BREVO_API_KEY,
          'content-type': 'application/json'
        }
      }
    );
    return true;
  } catch (error) {
    const errorDetails = error.response ? JSON.stringify(error.response.data) : error.message;
    console.error("[EMAIL ERROR] Echec d'envoi alerte admin :", errorDetails);
    return false;
  }
};

const sendCrashReportEmail = async (reportData) => {
  const adminEmail = process.env.ADMIN_EMAIL || "yelyinfos@gmail.com";
  const {
    errorName = "Erreur Inconnue",
    errorMessage = "Aucun message spécifié",
    errorStack = "Non disponible",
    componentStack = "Non disponible",
    user = {},
    device = {},
    timestamp = new Date().toISOString()
  } = reportData;

  const dateFormatted = new Date(timestamp).toLocaleString('fr-FR', {
    timeZone: 'Africa/Abidjan',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { margin: 0; padding: 0; background-color: #0A0A0A; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #FFFFFF; }
        .container { max-width: 650px; margin: 30px auto; background-color: #141414; border-radius: 16px; border: 1px solid #2A2A2A; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.8); }
        .header { background: linear-gradient(135deg, #1F1B0E 0%, #000000 100%); padding: 25px 30px; border-bottom: 2px solid #D4AF37; }
        .badge { display: inline-block; background-color: #C0392B; color: #FFFFFF; font-size: 11px; font-weight: 800; padding: 4px 10px; border-radius: 6px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 10px; }
        .title { margin: 0; font-size: 20px; font-weight: 800; color: #FFFFFF; }
        .time { font-size: 12px; color: #888888; margin-top: 6px; }
        .content { padding: 25px 30px; }
        .section-card { background-color: #1A1A1A; border-radius: 12px; padding: 18px; margin-bottom: 20px; border: 1px solid #333333; }
        .section-title { font-size: 13px; font-weight: 800; color: #D4AF37; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px; border-bottom: 1px solid #282828; padding-bottom: 6px; }
        .row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 13px; }
        .label { color: #888888; }
        .val { color: #FFFFFF; font-weight: 600; text-align: right; }
        .error-box { background-color: rgba(192, 57, 43, 0.15); border: 1px solid #C0392B; border-radius: 10px; padding: 14px; margin-bottom: 20px; }
        .error-title { color: #E74C3C; font-weight: 800; font-size: 14px; margin-bottom: 4px; }
        .error-msg { color: #FADBD8; font-size: 13px; line-height: 18px; margin: 0; word-break: break-word; }
        .stack-box { background-color: #050505; border-radius: 8px; padding: 14px; border: 1px solid #222222; font-family: Monaco, Consolas, 'Courier New', monospace; font-size: 11px; color: #7F8C8D; overflow-x: auto; white-space: pre-wrap; line-height: 16px; max-height: 250px; }
        .footer { background-color: #0A0A0A; padding: 18px 30px; text-align: center; border-top: 1px solid #222222; font-size: 11px; color: #555555; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="badge">Alerte Critique Mobile</div>
          <h1 class="title">Rapport de Crash Application Yély</h1>
          <div class="time">Date de survenue : ${dateFormatted} (Heure Abidjan)</div>
        </div>

        <div class="content">
          <div class="error-box">
            <div class="error-title">🚨 ${errorName}</div>
            <p class="error-msg">${errorMessage}</p>
          </div>

          <div class="section-card">
            <div class="section-title">👤 Profil Utilisateur</div>
            <div class="row"><span class="label">Rôle :</span><span class="val" style="color: #D4AF37;">${user.role ? user.role.toUpperCase() : 'Non connecté'}</span></div>
            <div class="row"><span class="label">Nom :</span><span class="val">${user.name || 'Visiteur'}</span></div>
            <div class="row"><span class="label">Téléphone :</span><span class="val">${user.phone || 'Non renseigné'}</span></div>
            <div class="row"><span class="label">Identifiant (ID) :</span><span class="val">${user.id || 'N/A'}</span></div>
          </div>

          <div class="section-card">
            <div class="section-title">📱 Appareil & Système</div>
            <div class="row"><span class="label">Plateforme / OS :</span><span class="val">${device.os || 'Android'} ${device.osVersion || ''}</span></div>
            <div class="row"><span class="label">Modèle :</span><span class="val">${device.model || 'Mobile Device'}</span></div>
            <div class="row"><span class="label">Version de l'App :</span><span class="val">${device.appVersion || '1.6.0'}</span></div>
          </div>

          <div class="section-card">
            <div class="section-title">💻 Trace Technique (Stack Trace)</div>
            <div class="stack-box">${errorStack}</div>
            ${componentStack && componentStack !== 'Non disponible' ? `
              <div class="section-title" style="margin-top: 14px;">🧩 Arborescence du Composant</div>
              <div class="stack-box">${componentStack}</div>
            ` : ''}
          </div>
        </div>

        <div class="footer">
          Système de télémétrie autonome Yély Inc. • Rapport transmis automatiquement par Brevo.
        </div>
      </div>
    </body>
    </html>
  `;

  try {
    await axios.post(
      'https://api.brevo.com/v3/smtp/email',
      {
        sender: { email: process.env.EMAIL_FROM || "noreply@yely.app", name: "Yely Crash Monitor" },
        to: [{ email: adminEmail }],
        subject: `🚨 [CRASH MOBILE] ${errorName} - Rôle: ${user.role || 'Visiteur'}`,
        htmlContent: htmlContent
      },
      {
        headers: {
          'accept': 'application/json',
          'api-key': process.env.BREVO_API_KEY,
          'content-type': 'application/json'
        }
      }
    );
    console.log(`[CRASH MONITOR] Rapport de crash envoye avec succes a ${adminEmail}`);
    return true;
  } catch (error) {
    const errorDetails = error.response ? JSON.stringify(error.response.data) : error.message;
    console.error("[CRASH MONITOR ERROR] Echec d'envoi Brevo :", errorDetails);
    return false;
  }
};

module.exports = { sendOtpEmail, sendAdminAlert, sendCrashReportEmail };