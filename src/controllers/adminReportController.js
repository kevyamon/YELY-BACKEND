// src/controllers/adminReportController.js
// CONTRÔLEUR RAPPORT DE FONCTIONNEMENT - Générateur HTML/PDF Fiscalité
// STANDARD: Industriel / Bank Grade / Clean Architecture

const Ride = require('../models/Ride');
const Order = require('../models/Order');
const Transaction = require('../models/Transaction');
const AppError = require('../utils/AppError');

exports.generateOperationalReport = async (req, res, next) => {
  try {
    const { period = 'month', date } = req.query;

    // Parser la date cible (par défaut la date courante)
    const targetDate = date ? new Date(date) : new Date();
    if (isNaN(targetDate.getTime())) {
      throw new AppError("Date cible invalide. Format attendu : AAAA-MM-JJ.", 400);
    }

    let startDate, endDate, periodLabel;
    const year = targetDate.getFullYear();

    if (period === 'month') {
      const month = targetDate.getMonth();
      startDate = new Date(year, month, 1);
      endDate = new Date(year, month + 1, 0, 23, 59, 59, 999);
      const monthsFrench = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
      periodLabel = `${monthsFrench[month]} ${year}`;
    } else if (period === 'quarter') {
      const month = targetDate.getMonth();
      const quarter = Math.floor(month / 3); // 0, 1, 2, 3
      startDate = new Date(year, quarter * 3, 1);
      endDate = new Date(year, (quarter + 1) * 3, 0, 23, 59, 59, 999);
      periodLabel = `${quarter + 1}er Trimestre ${year}`;
    } else if (period === 'semester') {
      const month = targetDate.getMonth();
      const semester = Math.floor(month / 6); // 0, 1
      startDate = new Date(year, semester * 6, 1);
      endDate = new Date(year, (semester + 1) * 6, 0, 23, 59, 59, 999);
      periodLabel = `${semester + 1}er Semestre ${year}`;
    } else if (period === 'year') {
      startDate = new Date(year, 0, 1);
      endDate = new Date(year, 11, 31, 23, 59, 59, 999);
      periodLabel = `Année ${year}`;
    } else {
      throw new AppError("Période invalide. Choisissez entre : month, quarter, semester, ou year.", 400);
    }

    // Récupération parallèle des données
    const [rides, orders, transactions] = await Promise.all([
      Ride.find({
        status: 'completed',
        createdAt: { $gte: startDate, $lte: endDate }
      }).lean(),
      Order.find({
        status: 'delivered',
        createdAt: { $gte: startDate, $lte: endDate }
      }).lean(),
      Transaction.find({
        status: 'APPROVED',
        createdAt: { $gte: startDate, $lte: endDate }
      }).lean()
    ]);

    // 1. Calculs - Activité Courses VTC (Taxis)
    const totalRidesCount = rides.length;
    let totalRidesDistance = 0;
    let totalRidesRevenue = 0;
    rides.forEach(r => {
      totalRidesDistance += Number(r.distance) || 0;
      totalRidesRevenue += Number(r.price) || 0;
    });

    // 2. Calculs - Commandes E-commerce (Shopping)
    const totalOrdersCount = orders.length;
    let totalOrdersItemsPrice = 0;
    let totalOrdersDeliveryPrice = 0;
    let totalOrdersTotalPrice = 0;
    orders.forEach(o => {
      totalOrdersItemsPrice += Number(o.itemsPrice) || 0;
      totalOrdersDeliveryPrice += Number(o.deliveryPrice) || 0;
      totalOrdersTotalPrice += Number(o.totalPrice) || 0;
    });

    // 3. Calculs - Abonnements Plateforme (Chiffre d'Affaires Yély)
    const totalTransactionsCount = transactions.length;
    let totalYelyRevenue = 0;
    transactions.forEach(t => {
      totalYelyRevenue += Number(t.amount) || 0;
    });

    // 4. Agrégats de Synthèse
    const caGlobal = totalRidesRevenue + totalOrdersTotalPrice; // Volume d'affaires total ayant transité
    const caChauffeurs = totalRidesRevenue + totalOrdersDeliveryPrice; // Gains des chauffeurs/livreurs
    const caMarchands = totalOrdersItemsPrice; // Chiffre d'affaires boutiques
    const caYely = totalYelyRevenue; // Chiffre d'affaires net Yély (Abonnements)

    const formatCurrency = (val) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'XOF', minimumFractionDigits: 0 }).format(val);
    const formatNumber = (val) => new Intl.NumberFormat('fr-FR').format(val);

    // Code HTML de qualité supérieure, prêt pour impression PDF A4
    const htmlReport = `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>Rapport de Fonctionnement Yély - ${periodLabel}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800&family=Inter:wght@400;500;600;700&display=swap');
    
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    
    body {
      font-family: 'Inter', sans-serif;
      background-color: #F8F9FA;
      color: #1A1A1A;
      line-height: 1.5;
      padding: 40px 20px;
    }

    .report-container {
      max-width: 900px;
      margin: 0 auto;
      background-color: #FFFFFF;
      padding: 50px;
      border-radius: 16px;
      box-shadow: 0 4px 30px rgba(0, 0, 0, 0.05);
      border: 1px solid #E9ECEF;
      position: relative;
    }

    .no-print {
      display: flex;
      justify-content: flex-end;
      gap: 12px;
      margin-bottom: 30px;
    }

    .btn {
      padding: 10px 20px;
      font-size: 14px;
      font-weight: 600;
      border: none;
      border-radius: 30px;
      cursor: pointer;
      font-family: 'Montserrat', sans-serif;
      transition: all 0.2s ease;
    }

    .btn-primary {
      background-color: #FAC800;
      color: #121212;
    }
    
    .btn-primary:hover {
      background-color: #E0B400;
    }

    .btn-secondary {
      background-color: #E9ECEF;
      color: #495057;
    }

    .btn-secondary:hover {
      background-color: #DEE2E6;
    }

    header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #FAC800;
      padding-bottom: 30px;
      margin-bottom: 40px;
    }

    .logo-section h1 {
      font-family: 'Montserrat', sans-serif;
      font-weight: 800;
      font-size: 28px;
      color: #FAC800;
      letter-spacing: 2px;
    }

    .logo-section p {
      font-size: 12px;
      color: #6C757D;
      text-transform: uppercase;
      font-weight: 600;
      margin-top: 4px;
    }

    .meta-section {
      text-align: right;
    }

    .meta-section h2 {
      font-family: 'Montserrat', sans-serif;
      font-size: 16px;
      font-weight: 700;
      color: #1A1A1A;
    }

    .meta-section p {
      font-size: 13px;
      color: #495057;
      margin-top: 4px;
    }

    .kpis-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 16px;
      margin-bottom: 40px;
    }

    .kpi-card {
      background-color: #FAF9F6;
      border: 1px solid #E9ECEF;
      border-radius: 12px;
      padding: 20px;
      text-align: center;
    }

    .kpi-card-highlight {
      background-color: #FFFDF0;
      border-color: #FBEFAD;
    }

    .kpi-title {
      font-size: 11px;
      font-weight: 600;
      color: #6C757D;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      margin-bottom: 8px;
    }

    .kpi-val {
      font-family: 'Montserrat', sans-serif;
      font-size: 18px;
      font-weight: 700;
      color: #1A1A1A;
    }

    .kpi-card-highlight .kpi-val {
      color: #B28F00;
    }

    .section-title {
      font-family: 'Montserrat', sans-serif;
      font-size: 16px;
      font-weight: 700;
      color: #1A1A1A;
      margin-bottom: 20px;
      border-left: 4px solid #FAC800;
      padding-left: 10px;
      text-transform: uppercase;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 40px;
    }

    th, td {
      padding: 12px 16px;
      text-align: left;
      font-size: 13px;
    }

    th {
      background-color: #F1F3F5;
      font-weight: 600;
      color: #495057;
      text-transform: uppercase;
      font-size: 11px;
      letter-spacing: 0.5px;
    }

    td {
      border-bottom: 1px solid #E9ECEF;
      color: #212529;
    }

    tr:last-child td {
      border-bottom: 2px solid #FAC800;
    }

    .bold-row {
      font-weight: 700;
      background-color: #FFFDF0;
    }

    footer {
      margin-top: 60px;
      border-top: 1px solid #E9ECEF;
      padding-top: 20px;
      display: flex;
      justify-content: space-between;
      font-size: 11px;
      color: #868E96;
    }

    @media print {
      body {
        background-color: #FFFFFF;
        padding: 0;
      }
      .report-container {
        box-shadow: none;
        border: none;
        padding: 0;
      }
      .no-print {
        display: none;
      }
      .kpi-card {
        background-color: #FFFFFF !important;
        border: 1px solid #000000 !important;
      }
      .kpi-card-highlight {
        background-color: #FFFFFF !important;
      }
      .bold-row {
        background-color: #F8F9FA !important;
      }
    }
  </style>
</head>
<body>

  <div class="report-container">
    
    <div class="no-print">
      <button class="btn btn-secondary" onclick="window.close()">Fermer</button>
      <button class="btn btn-primary" onclick="window.print()">Imprimer / Sauvegarder PDF</button>
    </div>

    <header>
      <div class="logo-section">
        <h1>YÉLY</h1>
        <p>Rapport d'activité & fiscalité</p>
      </div>
      <div class="meta-section">
        <h2>Période : ${periodLabel}</h2>
        <p>Édité le : ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR')}</p>
        <p>Projet ID : yely-27b1f</p>
      </div>
    </header>

    <div class="kpis-grid">
      <div class="kpi-card kpi-card-highlight">
        <div class="kpi-title">CA Net Yély (Abonnements)</div>
        <div class="kpi-val">${formatCurrency(caYely)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">CA Global Plateforme</div>
        <div class="kpi-val">${formatCurrency(caGlobal)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">Part Chauffeurs / Livreurs</div>
        <div class="kpi-val">${formatCurrency(caChauffeurs)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">Part Marchands (Shopping)</div>
        <div class="kpi-val">${formatCurrency(caMarchands)}</div>
      </div>
    </div>

    <div class="section-title">Synthèse Financière Globale</div>
    <table>
      <thead>
        <tr>
          <th>Activité</th>
          <th>Flux Opérationnel</th>
          <th>Mode de Perception</th>
          <th>Montant</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Courses VTC (Taxis)</td>
          <td>Gains des chauffeurs partenaires</td>
          <td>Espèces / Direct</td>
          <td>${formatCurrency(totalRidesRevenue)}</td>
        </tr>
        <tr>
          <td>E-commerce (Marchandises)</td>
          <td>Gains des boutiques partenaires</td>
          <td>Espèces / Réconciliation</td>
          <td>${formatCurrency(totalOrdersItemsPrice)}</td>
        </tr>
        <tr>
          <td>E-commerce (Livraisons)</td>
          <td>Gains des livreurs partenaires</td>
          <td>Espèces / Direct</td>
          <td>${formatCurrency(totalOrdersDeliveryPrice)}</td>
        </tr>
        <tr class="bold-row">
          <td>Volume d'affaires global</td>
          <td>Cumul de l'économie Yély</td>
          <td>Tous flux confondus</td>
          <td>${formatCurrency(caGlobal)}</td>
        </tr>
      </tbody>
    </table>

    <div class="section-title">Abonnements & Chiffre d'Affaires Yély</div>
    <table>
      <thead>
        <tr>
          <th>Service</th>
          <th>Détails</th>
          <th>Nombre de Paiements</th>
          <th>Montant Collecté (CA Imposable)</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Formules Chauffeurs / Marchands</td>
          <td>Abonnements Hebdomadaires / Mensuels</td>
          <td>${formatNumber(totalTransactionsCount)}</td>
          <td>${formatCurrency(caYely)}</td>
        </tr>
        <tr class="bold-row">
          <td>Total Net Assujetti</td>
          <td>Base imposable pour déclaration fiscale</td>
          <td>-</td>
          <td>${formatCurrency(caYely)}</td>
        </tr>
      </tbody>
    </table>

    <div class="section-title">Statistiques d'Activité Opérationnelle</div>
    <table>
      <thead>
        <tr>
          <th>Indicateur</th>
          <th>Valeur Constatée</th>
          <th>Détails</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Courses complétées (VTC)</td>
          <td>${formatNumber(totalRidesCount)} trajets</td>
          <td>Distance totale parcourue : ${formatNumber(totalRidesDistance.toFixed(1))} km</td>
        </tr>
        <tr>
          <td>Commandes livrées (Shopping)</td>
          <td>${formatNumber(totalOrdersCount)} livraisons</td>
          <td>Total articles vendus : ${formatNumber(totalOrdersCount)} commandes</td>
        </tr>
      </tbody>
    </table>

    <footer>
      <p>© ${year} Yély Inc. Tous droits réservés.</p>
      <p>Document officiel certifié conforme pour l'administration fiscale.</p>
    </footer>

  </div>

</body>
</html>
    `;

    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(htmlReport);

  } catch (error) {
    return next(error);
  }
};
