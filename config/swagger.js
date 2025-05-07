// config/swagger.js
const swaggerJsdoc = require('swagger-jsdoc');

// Basic Swagger definition
const swaggerDefinition = {
    openapi: '3.0.0', // OpenAPI version
    info: {
        title: 'Notes & Tasks Backend API', // Title of your API
        version: '1.0.0', // Version of your API
        description: 'API documentation for the Notes & Tasks backend service, handling user authentication and data management.',
        // You can add contact, license details etc. here
        // contact: {
        //   name: 'API Support',
        //   url: 'http://www.example.com/support',
        //   email: 'support@example.com',
        // },
    },
    servers: [
        {
            url: `http://localhost:${process.env.PORT || 5001}/api`, // Base URL for API requests
            description: 'Development server',
        },
        // You can add more servers here (e.g., production)
    ],
    // Define reusable components/schemas
    components: {
        schemas: {
            UserInput: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                    email: {
                        type: 'string',
                        format: 'email',
                        description: 'User\'s email address.',
                        example: 'user@example.com',
                    },
                    password: {
                        type: 'string',
                        format: 'password',
                        description: 'User\'s password (min 8 characters).',
                        example: 'password123',
                    },
                },
            },
            UserResponse: { // Schema for user object returned (WITHOUT password)
                type: 'object',
                properties: {
                    _id: {
                        type: 'string',
                        format: 'objectId',
                        description: 'User ID',
                        example: '605c72ef9f1d4e2f3c6e4b1c',
                    },
                    email: {
                        type: 'string',
                        format: 'email',
                        example: 'user@example.com',
                    },
                    notesTree: {
                        type: 'array',
                        description: "User's notes and tasks data structure (can be complex)",
                        example: [],
                    },
                    createdAt: {
                        type: 'string',
                        format: 'date-time',
                    },
                    updatedAt: {
                        type: 'string',
                        format: 'date-time',
                    }
                }
            },
            AuthResponse: { // Schema for successful auth responses
                type: 'object',
                properties: {
                    token: {
                        type: 'string',
                        description: 'JWT authentication token',
                        example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
                    },
                    user: {
                        $ref: '#/components/schemas/UserResponse', // Reference the User schema
                    },
                },
            },
            ErrorResponse: {
                type: 'object',
                properties: {
                    error: {
                        type: 'string',
                        description: 'Description of the error',
                        example: 'Invalid credentials',
                    },
                },
            },
        },
        // Optional: Define security schemes if you add protected routes later
        // securitySchemes: {
        //   bearerAuth: {
        //     type: 'http',
        //     scheme: 'bearer',
        //     bearerFormat: 'JWT',
        //   },
        // },
    },
    // Optional: Global security definition (applied to all paths unless overridden)
    // security: [
    //   {
    //     bearerAuth: [],
    //   },
    // ],
};

// Options for swagger-jsdoc
const options = {
    swaggerDefinition,
    // Path to the API docs (your route files)
    apis: ['./routes/*.js'], // Glob pattern to include all route files
};

// Initialize swagger-jsdoc -> returns validated swagger spec in json format
const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;