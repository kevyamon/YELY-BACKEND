// tests/auth.test.js
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../src/app');
const User = require('../src/models/User');
const { env } = require('../src/config/env');

// Connexion à une DB de test avant les tests
beforeAll(async () => {
  const testURI = env.MONGO_URI.replace('?', '_test?'); // Utilise une DB séparée
  await mongoose.connect(testURI);
});

// Nettoyage après les tests
afterAll(async () => {
  await User.deleteMany({ email: 'test@yely.com' }); // Nettoyage
  await mongoose.connection.close();
});

describe('Auth Endpoints', () => {
  it('Devrait inscrire un nouvel utilisateur', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Test User',
        email: 'test@yely.com',
        phone: '+2250102030405',
        password: 'Password123!',
        role: 'rider'
      });
    
    expect(res.statusCode).toEqual(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user).toHaveProperty('email', 'test@yely.com');
  });

  it('Ne devrait pas inscrire un doublon', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Test User 2',
        email: 'test@yely.com', // Même email
        phone: '+2250102030405',
        password: 'Password123!',
        role: 'rider'
      });
    
    expect(res.statusCode).toEqual(409); // Conflit
  });
});