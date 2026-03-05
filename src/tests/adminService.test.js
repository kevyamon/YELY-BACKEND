// src/tests/adminService.test.js
// TESTS UNITAIRES - Gouvernance et Securite Admin
// STANDARD: Industriel / Bank Grade

const { updateUserRole } = require('../services/adminService');
const User = require('../models/User');
const AppError = require('../utils/AppError');

// Simulations des dependances pour isoler la logique metier
jest.mock('../models/User');
jest.mock('../models/AuditLog');
jest.mock('../config/redis', () => ({
  del: jest.fn()
}));

describe('AdminService Logic', () => {
  
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Gestion des Roles (updateUserRole)', () => {
    
    test('Doit interdire formellement l\'auto-promotion', async () => {
      await expect(updateUserRole('user_123', 'PROMOTE', 'user_123'))
        .rejects.toThrow(AppError);
        
      await expect(updateUserRole('user_123', 'PROMOTE', 'user_123'))
        .rejects.toThrow('Auto-promotion interdite.');
    });

    test('Doit interdire toute modification du role superadmin', async () => {
      User.findById.mockResolvedValue({ 
        _id: 'target_123', 
        role: 'superadmin',
        save: jest.fn()
      });
      
      await expect(updateUserRole('target_123', 'REVOKE', 'admin_456'))
        .rejects.toThrow(AppError);
        
      await expect(updateUserRole('target_123', 'REVOKE', 'admin_456'))
        .rejects.toThrow('Le SuperAdmin est intouchable.');
    });

    test('Doit rejeter une transition de role invalide', async () => {
      User.findById.mockResolvedValue({ 
        _id: 'target_123', 
        role: 'admin', // Un admin ne peut pas etre "PROMU" a nouveau selon nos regles
        save: jest.fn()
      });
      
      await expect(updateUserRole('target_123', 'PROMOTE', 'admin_456'))
        .rejects.toThrow('Action impossible sur un profil admin.');
    });
  });
});