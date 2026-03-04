// src/utils/emailService.js
// SERVICE D'ENVOI D'EMAILS - Template Premium Yely
// CSCSM Level: Bank Grade

const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: false, 
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// REMPLACE CETTE URL par l'URL de ton logo sur Cloudinary
const LOGO_URL = "https://res.cloudinary.com/dskdkrwhq/image/upload/v1772629185/photo_2026-03-04_12-55-42_b9icek.jpg";
const GOLD_COLOR = "#D4AF37"; // Ton Champagne Gold

const sendOtpEmail = async (to, otp) => {
  const mailOptions = {
    from: `"Yely Support" <${process.env.EMAIL_FROM}>`,
    to,
    subject: `🔐 ${otp} est votre code de sécurité Yely`,
    html: `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(212, 175, 55, 0.4); } 70% { box-shadow: 0 0 0 15px rgba(212, 175, 55, 0); } 100% { box-shadow: 0 0 0 0 rgba(212, 175, 55, 0); } }
        .container { animation: fadeIn 0.8s ease-out; }
        .otp-box { animation: pulse 2s infinite; }
      </style>
    </head>
    <body style="margin: 0; padding: 0; background-color: #0F0F0F; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;">
      <table width="100%" border="0" cellspacing="0" cellpadding="0">
        <tr>
          <td align="center" style="padding: 40px 0;">
            <div class="container" style="max-width: 500px; width: 90%; background-color: #1A1A1A; border: 1px solid #333; border-radius: 20px; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.5);">
              
              <div style="padding: 30px; text-align: center; background: linear-gradient(135deg, #1A1A1A 0%, #000000 100%);">
                <img src="${LOGO_URL}" alt="Yely Logo" width="120" style="display: block; margin: 0 auto;">
              </div>

              <div style="padding: 40px 30px; text-align: center;">
                <h1 style="color: #FFFFFF; font-size: 24px; margin-bottom: 10px; font-weight: 300;">Réinitialisation</h1>
                <p style="color: #AAAAAA; font-size: 16px; line-height: 24px; margin-bottom: 30px;">
                  Vous avez demandé la réinitialisation de votre mot de passe. <br>
                  Entrez le code sécurisé ci-dessous dans l'application :
                </p>

                <div class="otp-box" style="display: inline-block; padding: 20px 40px; background-color: #000000; border: 2px solid ${GOLD_COLOR}; border-radius: 12px; margin-bottom: 30px;">
                  <span style="font-size: 38px; font-weight: bold; letter-spacing: 10px; color: ${GOLD_COLOR}; text-shadow: 0 0 10px rgba(212, 175, 55, 0.3);">
                    ${otp}
                  </span>
                </div>

                <p style="color: #666666; font-size: 12px;">
                  Ce code expire dans 15 minutes. <br>
                  Si vous n'êtes pas à l'origine de cette demande, ignorez ce mail.
                </p>
              </div>

              <div style="background-color: #111111; padding: 20px; text-align: center; border-top: 1px solid #333;">
                <p style="color: #444444; font-size: 11px; margin: 0;">
                  © 2026 Yely Tech Team. Tous droits réservés. <br>
                  Abidjan, Côte d'Ivoire.
                </p>
              </div>
            </div>
          </td>
        </tr>
      </table>
    </body>
    </html>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
  } catch (error) {
    console.error("[EMAIL ERROR] Echec envoi OTP:", error);
    throw new Error("Service de mail indisponible.");
  }
};

module.exports = { sendOtpEmail };