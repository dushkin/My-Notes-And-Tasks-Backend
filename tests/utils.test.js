const mongoose = require('mongoose');
const { hashPassword, comparePassword } = require('../utils/hash');
const { generateAccessToken, verifyAccessToken } = require('../utils/jwt');

describe('Hash Utilities', () => {
  it('should hash and verify a password correctly', async () => {
    const plain = 'superSecure123!';
    const hashed = await hashPassword(plain);
    expect(typeof hashed).toBe('string');
    const isMatch = await comparePassword(plain, hashed);
    expect(isMatch).toBe(true);
  });
});

describe('JWT Utilities', () => {
  it('should generate and verify an access token', () => {
    const userId = new mongoose.Types.ObjectId().toHexString();
    const token = generateAccessToken(userId);
    expect(typeof token).toBe('string');
    const decoded = verifyAccessToken(token);
    expect(decoded).toHaveProperty('user');
    expect(decoded.user).toHaveProperty('id', userId);
  });
});
