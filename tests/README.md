# Backend Testing Infrastructure

This directory contains comprehensive tests for the Notes & Tasks backend API.

## Test Structure

```
tests/
├── helpers/
│   └── testHelpers.js          # Common test utilities and helpers
├── unit/
│   ├── models.test.js          # Database model tests
│   ├── services.test.js        # Service layer tests
│   └── utils.test.js           # Utility function tests
├── integration/
│   ├── auth.api.test.js        # Authentication endpoint tests
│   ├── items.api.test.js       # Items/Notes API tests
│   └── images.api.test.js      # Image upload tests
├── fixtures/
│   ├── test-image.png          # Test image for upload tests
│   ├── test.png               # Another test image
│   └── test.txt               # Non-image test file
├── setupTests.js              # Global test setup
└── README.md                  # This file
```

## Test Categories

### Unit Tests
- **Models**: Test database models, validation, and methods
- **Services**: Test business logic and service layer functions  
- **Utils**: Test utility functions and helpers

### Integration Tests
- **Auth API**: User registration, login, token management
- **Items API**: CRUD operations for notes/tasks/folders
- **Images API**: File upload and processing

## Running Tests

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run in watch mode
npm run test:watch

# Run specific test types
npm run test:unit
npm run test:integration
npm run test:api

# Debug tests
npm run test:debug
```

## Test Database

Tests use **MongoDB Memory Server** for isolated testing:
- In-memory MongoDB instance per test run
- No pollution of development/production databases
- Fast test execution
- Automatic cleanup after tests

## Authentication in Tests

Test helpers provide utilities for creating authenticated requests:

```javascript
import { createTestUser, makeAuthenticatedRequest } from '../helpers/testHelpers.js';

// Create test user and get auth token
const { user, token } = await createTestUser('test@example.com');

// Make authenticated requests
const authRequest = makeAuthenticatedRequest(app, token);
const response = await authRequest.get('/api/items/tree');
```

## Test Data Management

- **Automatic cleanup** after each test
- **Mock data generators** for consistent test data
- **Isolated test users** to prevent data conflicts
- **Fixture files** for file upload testing

## Coverage Reports

Coverage reports are generated in multiple formats:
- **Terminal**: Text summary during test runs
- **HTML**: Detailed coverage report in `coverage/` directory
- **LCOV**: Machine-readable format for CI/CD integration

## Coverage Thresholds

| Component | Branches | Functions | Lines | Statements |
|-----------|----------|-----------|-------|------------|
| Global    | 75%      | 75%       | 75%   | 75%        |
| Controllers| 80%     | 80%       | 80%   | 80%        |
| Models    | 85%      | 85%       | 85%   | 85%        |
| Utils     | 90%      | 90%       | 90%   | 90%        |

## Best Practices

### Test Organization
- Group related tests using `describe` blocks
- Use descriptive test names that explain expected behavior
- Follow AAA pattern: Arrange, Act, Assert

### Data Management
- Clean up test data after each test
- Use factories/helpers for creating test data
- Avoid hard-coded values, use dynamic data

### Assertions
- Use specific assertions over generic ones
- Test both success and error cases
- Verify side effects (database changes, external calls)

### Mocking
- Mock external services (push notifications, file systems)
- Don't mock the code under test
- Reset mocks between tests

## Environment Variables

Tests automatically load environment variables from `.env` file. Required variables:
- `JWT_SECRET`: For token generation/verification
- `MONGODB_URI`: Overridden by MongoDB Memory Server
- Other service-specific variables as needed

## Continuous Integration

Tests are configured for CI/CD with:
- **JUnit XML** output for test reporting
- **Coverage** reports in multiple formats
- **Proper exit codes** for build success/failure
- **Parallel test execution** disabled for database consistency

## Debugging Tests

For debugging failing tests:
1. Use `npm run test:debug` to run with Node.js debugger
2. Add `console.log` statements for quick debugging
3. Check test isolation by running individual test files
4. Verify test data cleanup between tests

## Adding New Tests

When adding new features:
1. **Unit tests** for new utility functions and models
2. **Integration tests** for new API endpoints
3. **Service tests** for business logic
4. Update coverage thresholds if needed
5. Add any new test fixtures to `fixtures/` directory

## Common Issues

### Test Timeouts
- Increase timeout in Jest config if database operations are slow
- Use `--runInBand` flag to prevent parallel execution issues

### Memory Leaks
- Ensure proper cleanup of database connections
- Close all async operations in test teardown

### Flaky Tests
- Usually caused by timing issues or shared state
- Use proper async/await patterns
- Ensure test isolation