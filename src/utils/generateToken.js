const jwt = require('jsonwebtoken');

const generateToken = (res, userId) => {
  const token = jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: '30d',
  });

  res.cookie('jwt', token, {
    httpOnly: true,
    secure: true, // Obligatoire sur Render (HTTPS)
    sameSite: 'none', // Permet au Frontend de lire le cookie depuis un autre domaine
    maxAge: 30 * 24 * 60 * 60 * 1000, 
  });

  return token;
};

module.exports = generateToken;