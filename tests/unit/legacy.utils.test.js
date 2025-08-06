// tests/utils.test.js
import mongoose from 'mongoose';
import { hashPassword, comparePassword } from '../../utils/hash.js';
import { generateAccessToken, verifyAccessToken } from '../../utils/jwt.js';

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
    const userId = new mongoose.Types.ObjectId().toString(); // Use toString() for string ID
    const token = generateAccessToken(userId);
    expect(typeof token).toBe('string');
    const decoded = verifyAccessToken(token);
    expect(decoded).toHaveProperty('user');
    expect(decoded.user).toHaveProperty('id', userId);
  });
});