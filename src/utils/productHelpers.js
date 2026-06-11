// src/utils/productHelpers.js
// HELPERS PRODUITS - Construction de requêtes et mapping de catégories
// STANDARD: Industriel / Bank Grade

const buildProductQuery = (queryParams, reqUser) => {
  const { category, seller, search } = queryParams;
  const query = { isActive: true };

  if (category) query.category = category;
  
  if (seller) {
    query.seller = seller;
  } else if (reqUser) {
    query.seller = { $ne: reqUser._id };
  }

  if (search) {
    const cleanSearch = search.trim();
    const lowerSearch = cleanSearch.toLowerCase();
    
    const CATEGORY_MAP = {
      'nourriture': 'Food',
      'food': 'Food',
      'resto': 'Food',
      'restaurant': 'Food',
      'plat': 'Food',
      'repas': 'Food',
      'manger': 'Food',
      'supermarche': 'Supermarket',
      'supermarché': 'Supermarket',
      'epicerie': 'Supermarket',
      'épicerie': 'Supermarket',
      'courses': 'Supermarket',
      'panier': 'Supermarket',
      'cosmetique': 'Cosmetics',
      'cosmétique': 'Cosmetics',
      'beaute': 'Cosmetics',
      'beauté': 'Cosmetics',
      'soins': 'Cosmetics',
      'maquillage': 'Cosmetics',
      'electronique': 'Electronics',
      'électronique': 'Electronics',
      'hightech': 'Electronics',
      'high-tech': 'Electronics',
      'telephone': 'Electronics',
      'téléphone': 'Electronics',
      'pc': 'Electronics',
      'maison': 'Home',
      'deco': 'Home',
      'déco': 'Home',
      'decoration': 'Home',
      'décoration': 'Home',
      'entretien': 'Home'
    };

    const matchedCategory = CATEGORY_MAP[lowerSearch];

    query.$or = [
      { name: { $regex: cleanSearch, $options: 'i' } },
      { description: { $regex: cleanSearch, $options: 'i' } }
    ];

    if (matchedCategory) {
      query.$or.push({ category: matchedCategory });
    }
  }

  return query;
};

module.exports = {
  buildProductQuery
};
