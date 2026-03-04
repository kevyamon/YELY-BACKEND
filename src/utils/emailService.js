// src/utils/emailService.js
// SERVICE D'ENVOI D'EMAILS - Connecteur SMTP Brevo
// CSCSM Level: Bank Grade

const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: false, // true pour le port 465, false pour 587
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const sendOtpEmail = async (to, otp) => {
  const mailOptions = {
    from: `"Support Yely" <${process.env.EMAIL_FROM}>`,
    to,
    subject: 'Réinitialisation de votre mot de passe - Yely',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
        <h2 style="color: #333; text-align: center;">Réinitialisation de mot de passe</h2>
        <p style="color: #555; font-size: 16px;">Bonjour,</p>
        <p style="color: #555; font-size: 16px;">Vous avez demandé à réinitialiser votre mot de passe sur l'application Yely. Voici votre code de sécurité à 6 chiffres :</p>
        
        <div style="text-align: center; margin: 30px 0;">
          <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #D4AF37; background-color: #f9f9f9; padding: 15px 30px; border-radius: 8px; border: 1px dashed #D4AF37;">
            ${otp}
          </span>
        </div>
        
        <p style="color: #555; font-size: 14px; text-align: center;">Ce code est valable pendant <b>15 minutes</b>.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
        <p style="color: #999; font-size: 12px; text-align: center;">Si vous n'avez pas fait cette demande, vous pouvez ignorer cet e-mail en toute sécurité. Votre compte est protégé.</p>
      </div>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
  } catch (error) {
    console.error("[EMAIL ERROR] Échec de l'envoi de l'OTP :", error);
    throw new Error("Impossible d'envoyer l'e-mail actuellement.");
  }
};

module.exports = { sendOtpEmail };