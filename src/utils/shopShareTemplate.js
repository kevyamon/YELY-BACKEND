// src/utils/shopShareTemplate.js
// TEMPLATE DE REDIRECTION ET GENERATION OPEN GRAPH
// STANDARD: Industriel / Bank Grade

const logger = require('../config/logger');

const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.yely.app';
const WEB_BASE_URL = 'https://yely-amber.vercel.app';

// Helper pour générer l'image Open Graph avec overlays
const getShareImageUrl = async (seller) => {
  try {
    const renderCloudName = 'dnps8hbco'; 
    const coverTemplatePublicId = 'd676581c-f7b9-4346-a3e1-5face25d9868';
    
    let baseImageUrl = seller.profilePicture || `${WEB_BASE_URL}/logo.png`;
    const b64Url = Buffer.from(baseImageUrl).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const sellerOverlayLayer = `fetch:${b64Url}`;
    
    return `https://res.cloudinary.com/${renderCloudName}/image/upload/w_1080,h_1080,c_fill,e_colorize:100,co_black/l_${sellerOverlayLayer},w_580,h_580,c_fill,r_max/fl_layer_apply,g_center,y_-15/l_${coverTemplatePublicId},w_1080,h_1080,c_fill,e_make_transparent/fl_layer_apply/sample.jpg`;
  } catch (error) {
    logger.error(`[SHARE IMAGE] Echec de generation de l'image de partage: ${error.message}`);
    return seller.profilePicture || `${WEB_BASE_URL}/logo.png`;
  }
};

const renderShareHtml = async (res, seller, userAgent = '') => {
  const ogImageUrl = await getShareImageUrl(seller);
  const shopTitle = `Boutique de ${seller.name}`;
  const shopDescription = `Découvrez ma boutique sur Yély. Commandez mes articles en direct et bénéficiez d'une livraison rapide.`;
  const shopSlug = seller.shopSlug || seller._id;
  const shareUrl = `${WEB_BASE_URL}/shop/${shopSlug}`;
  const webStoreHref = `${WEB_BASE_URL}/store/${shopSlug}`;

  const isAndroid = /Android/i.test(userAgent);
  const isIOS = /iPhone|iPad|iPod/i.test(userAgent);

  let deepLinkHref;
  if (isAndroid) {
    const fallbackEncoded = encodeURIComponent(PLAY_STORE_URL);
    deepLinkHref = `intent://store/${shopSlug}#Intent;scheme=yely;package=com.yely.app;S.browser_fallback_url=${fallbackEncoded};end`;
  } else if (isIOS) {
    deepLinkHref = `yely://store/${shopSlug}`;
  } else {
    deepLinkHref = webStoreHref;
  }

  res.setHeader('Content-Type', 'text/html');
  return res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <title>${shopTitle} | Yély</title>
  
  <meta property="og:type" content="profile">
  <meta property="og:title" content="${shopTitle}">
  <meta property="og:description" content="${shopDescription}">
  <meta property="og:image" content="${ogImageUrl}">
  <meta property="og:image:width" content="500">
  <meta property="og:image:height" content="500">
  <meta property="og:url" content="${shareUrl}">

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${shopTitle}">
  <meta name="twitter:description" content="${shopDescription}">
  <meta name="twitter:image" content="${ogImageUrl}">

  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@500;700;800;900&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  
  <style>
    :root {
      --primary: #D4AF37;
      --bg: #050505;
      --card-bg: rgba(20, 20, 20, 0.75);
      --border: rgba(212, 175, 55, 0.25);
      --text: #ffffff;
      --text-muted: rgba(255, 255, 255, 0.65);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: 'Inter', sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 20px;
      background-image: radial-gradient(circle at 50% 30%, rgba(212, 175, 55, 0.12), transparent 70%);
    }
    .container {
      width: 100%;
      max-width: 400px;
      padding: 32px 24px;
      border-radius: 28px;
      background: var(--card-bg);
      border: 1px solid var(--border);
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.9);
      backdrop-filter: blur(25px);
      -webkit-backdrop-filter: blur(25px);
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
    }
    .avatar-wrapper { position: relative; margin-bottom: 16px; }
    .logo-img {
      width: 105px;
      height: 105px;
      border-radius: 50%;
      border: 2.5px solid var(--primary);
      object-fit: cover;
      box-shadow: 0 8px 24px rgba(212, 175, 55, 0.3);
    }
    .badge-icon {
      position: absolute;
      bottom: 2px;
      right: 2px;
      background: #000;
      border-radius: 50%;
      width: 26px;
      height: 26px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px solid rgba(255, 255, 255, 0.15);
    }
    h1 {
      font-family: 'Outfit', sans-serif;
      font-size: 23px;
      font-weight: 800;
      color: #fff;
      margin-bottom: 6px;
      letter-spacing: -0.3px;
    }
    .rating-badge {
      display: flex;
      align-items: center;
      background: rgba(212, 175, 55, 0.12);
      border: 1px solid rgba(212, 175, 55, 0.25);
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 13px;
      color: var(--primary);
      font-weight: 700;
      margin-bottom: 18px;
    }
    p {
      color: var(--text-muted);
      font-size: 13.5px;
      line-height: 1.5;
      margin-bottom: 24px;
      max-width: 90%;
    }
    .btn-group {
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .btn {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      width: 100%;
      padding: 13px 18px;
      border-radius: 16px;
      font-family: 'Outfit', sans-serif;
      text-decoration: none;
      transition: all 0.2s ease;
      cursor: pointer;
      border: none;
      gap: 2px;
    }
    .btn-title { font-weight: 800; font-size: 15px; }
    .btn-subtitle { font-family: 'Inter', sans-serif; font-size: 11px; font-weight: 500; opacity: 0.85; }
    .btn-primary {
      background-color: var(--primary);
      color: #000000;
      box-shadow: 0 6px 20px rgba(212, 175, 55, 0.25);
    }
    .btn-primary:active { transform: scale(0.98); }
    .btn-secondary {
      background-color: rgba(255, 255, 255, 0.05);
      color: #ffffff;
      border: 1px solid rgba(255, 255, 255, 0.1);
    }
    .btn-secondary:active { transform: scale(0.98); }
    .btn-playstore {
      display: flex;
      flex-direction: row;
      align-items: center;
      justify-content: center;
      gap: 10px;
      background: #000000;
      border: 1.5px solid rgba(212, 175, 55, 0.4);
      color: #ffffff;
      padding: 11px 16px;
      border-radius: 16px;
      text-decoration: none;
      transition: all 0.2s;
    }
    .btn-playstore:active { transform: scale(0.98); }
    .play-text-box { display: flex; flex-direction: column; text-align: left; }
    .play-label { font-size: 9.5px; text-transform: uppercase; color: var(--text-muted); font-weight: 600; }
    .play-title { font-family: 'Outfit', sans-serif; font-size: 14px; font-weight: 800; color: #fff; }
    .btn-subtle {
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 12.5px;
      font-weight: 600;
      text-decoration: underline;
      margin-top: 8px;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="avatar-wrapper">
      <img class="logo-img" src="${seller.profilePicture || `${WEB_BASE_URL}/logo.png`}" alt="Boutique" />
      <div class="badge-icon">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
          <path d="M23 12L20.56 9.22L20.9 5.54L17.29 4.72L15 1.4L11.5 2.92L8 1.4L5.71 4.72L2.1 5.54L2.44 9.22L0 12L2.44 14.78L2.1 18.46L5.71 19.28L8 22.6L11.5 21.08L15 22.6L17.29 19.28L20.9 18.46L20.56 14.78L23 12ZM10 17L6 13L7.41 11.59L10 14.17L16.59 7.58L18 9L10 17Z" fill="#D4AF37"/>
        </svg>
      </div>
    </div>
    
    <h1>${seller.name}</h1>
    
    <div class="rating-badge">
      ★ ${seller.rating ? seller.rating.toFixed(1) : '5.0'} / 5.0
    </div>
    
    <p>Commandez mes articles en direct avec une livraison rapide sur Yély.</p>
    
    <div class="btn-group">
      ${isAndroid ? `
        <!-- TUNNEL ANDROID -->
        <a href="${deepLinkHref}" class="btn btn-primary">
          <span class="btn-title">Ouvrir dans l'application Yély</span>
          <span class="btn-subtitle">Si l'application est déjà installée</span>
        </a>

        <a href="${PLAY_STORE_URL}" target="_blank" rel="noopener noreferrer" class="btn-playstore">
          <svg width="22" height="24" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M3.6 1.8L13.8 12 3.6 22.2c-.4-.4-.6-1-.6-1.7V3.5c0-.7.2-1.3.6-1.7z"/>
            <path fill="#FBBC04" d="M17.3 8.5l-3.5 3.5 3.5 3.5 4.1-2.4c1.2-.7 1.2-1.9 0-2.6l-4.1-2z"/>
            <path fill="#EA4335" d="M13.8 12L3.6 1.8c.6-.4 1.4-.4 2.2 0l11.5 6.7-3.5 3.5z"/>
            <path fill="#34A853" d="M13.8 12l3.5 3.5-11.5 6.7c-.8.4-1.6.4-2.2 0L13.8 12z"/>
          </svg>
          <div class="play-text-box">
            <span class="play-label">Télécharger sur</span>
            <span class="play-title">Google Play</span>
          </div>
        </a>

        <a href="${webStoreHref}" class="btn-subtle">
          Ou continuer sur le Web sans installer
        </a>
      ` : isIOS ? `
        <!-- TUNNEL IPHONE / IOS (PWA) -->
        <a href="${webStoreHref}" class="btn btn-primary">
          <span class="btn-title">Visiter la boutique & Commander</span>
          <span class="btn-subtitle">Boutique web optimisée iPhone / Safari</span>
        </a>

        <a href="${deepLinkHref}" class="btn btn-secondary">
          <span class="btn-title">Ouvrir dans l'application</span>
          <span class="btn-subtitle">Si déjà installée sur votre mobile</span>
        </a>
      ` : `
        <!-- TUNNEL DESKTOP / AUTRES -->
        <a href="${webStoreHref}" class="btn btn-primary">
          <span class="btn-title">Visiter la boutique en ligne</span>
          <span class="btn-subtitle">Commander directement depuis votre navigateur</span>
        </a>

        <a href="${PLAY_STORE_URL}" target="_blank" rel="noopener noreferrer" class="btn-playstore">
          <svg width="20" height="22" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M3.6 1.8L13.8 12 3.6 22.2c-.4-.4-.6-1-.6-1.7V3.5c0-.7.2-1.3.6-1.7z"/>
            <path fill="#FBBC04" d="M17.3 8.5l-3.5 3.5 3.5 3.5 4.1-2.4c1.2-.7 1.2-1.9 0-2.6l-4.1-2z"/>
            <path fill="#EA4335" d="M13.8 12L3.6 1.8c.6-.4 1.4-.4 2.2 0l11.5 6.7-3.5 3.5z"/>
            <path fill="#34A853" d="M13.8 12l3.5 3.5-11.5 6.7c-.8.4-1.6.4-2.2 0L13.8 12z"/>
          </svg>
          <div class="play-text-box">
            <span class="play-label">Disponible sur</span>
            <span class="play-title">Google Play</span>
          </div>
        </a>
      `}
    </div>
  </div>
</body>
</html>`);
};

module.exports = {
  getShareImageUrl,
  renderShareHtml
};
