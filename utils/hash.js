// utils/hash.js
import bcrypt from 'bcrypt';

const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS || '10');

/**
 * Hashes a plain text password.
 * @param {string} password - The plain text password.
 * @returns {Promise<string>} - A promise that resolves with the hashed password.
 */
export const hashPassword = async (password) => {
    if (!password) {
        throw new Error('Password is required for hashing.');
    }
    return bcrypt.hash(password, saltRounds);
};

/**
 * Compares a plain text password with a stored hash.
 * @param {string} plainPassword - The plain text password provided by the user.
 * @param {string} hashedPassword - The stored hashed password.
 * @returns {Promise<boolean>} - A promise that resolves with true if passwords match, false otherwise.
 */
export const comparePassword = async (plainPassword, hashedPassword) => {
    if (!plainPassword || !hashedPassword) {
        // Avoid errors if one is missing, comparison will just fail safely
        return false;
    }
    return bcrypt.compare(plainPassword, hashedPassword);
};