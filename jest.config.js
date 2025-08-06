// jest.config.js
export default {
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/tests/setupTests.js'],
  testMatch: [
    '**/tests/**/*.test.js',
    '**/tests/**/*.spec.js'
  ],
  testTimeout: 30000,
  maxWorkers: 1,
  verbose: true,
  clearMocks: true,
  restoreMocks: true,
  forceExit: true
};