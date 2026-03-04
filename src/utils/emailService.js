// src/utils/emailService.js
// SERVICE D'ENVOI D'EMAILS - Connecteur API REST Brevo (Contournement Pare-feu Cloud)
// CSCSM Level: Bank Grade

const axios = require('axios');

const LOGO_URL = "https://res.cloudinary.com/dskdkrwhq/image/upload/v1772629185/photo_2026-03-04_12-55-42_b9icek.jpg";
const GOLD_COLOR = "#D4AF37";

const sendOtpEmail = async (to, otp) => {
  console.log("[DEBUG - EMAIL] Utilisation de l'API HTTP Brevo (Port 443 HTTPS)...");

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
    // On appelle directement l'API v3 de Brevo au lieu du SMTP
    const response = await axios.post(
      'https://api.brevo.com/v3/smtp/email',
      {
        sender: { email: process.env.EMAIL_FROM, name: "Yely Support" },
        to: [{ email: to }],
        subject: `🔐 ${otp} est votre code de sécurité Yely`,
        htmlContent: htmlContent
      },
      {
        headers: {
          'accept': 'application/json',
          'api-key': process.env.SMTP_PASS, // La clé API Brevo est requise ici (généralement identique au SMTP_PASS)
          'content-type': 'application/json'
        }
      }
    );

    console.log("[DEBUG - EMAIL] Mail envoyé avec succès via l'API HTTP Brevo !");
    return true;

  } catch (error) {
    const errorDetails = error.response ? JSON.stringify(error.response.data) : error.message;
    console.error("[EMAIL ERROR] Echec API HTTP :", errorDetails);
    throw new Error(`Impossible d'envoyer l'email via API HTTP.`);
  }
};

module.exports = { sendOtpEmail };