# Notes & Tasks - Backend API

This repository contains the source code for the backend REST API that powers the [Notes & Tasks application](https://github.com/dushkin/My-Notes-and-Tasks). It is a secure, robust, and scalable service built with Node.js, Express, and MongoDB.

**[View API Documentation](http://localhost:5001/api-docs)** (while running locally)

---

## 🔧 **Backend Features & Capabilities**

### **Authentication & Security**
- **JWT-based Authentication**: Secure token-based authentication system with access and refresh tokens for enhanced security
- **Password Security**: Passwords are securely hashed using `bcrypt` with salt
- **Rate Limiting**: Protection against brute-force attacks on authentication and other key endpoints
- **Security Headers**: `helmet` implementation for protection against common web vulnerabilities
- **Input Sanitization**: Protection against NoSQL injection and XSS attacks using express-mongo-sanitize and xss-clean
- **CORS Configuration**: Configurable Cross-Origin Resource Sharing for secure API access
- **Data Encryption**: Field-level encryption for sensitive user data using mongoose-field-encryption

### **RESTful API Architecture**
- **Comprehensive API Endpoints**:
  - **Authentication Routes**: Login, register, refresh token, logout, password reset
  - **Items Management**: Full CRUD operations for notes, tasks, and folders
  - **Image Upload & Management**: Secure file upload with processing
  - **User Account Management**: Profile updates, account deletion, subscription management
  - **Synchronization**: Real-time data sync endpoints
  - **Admin Functionality**: User management, analytics, system monitoring
  - **Push Notifications**: Device registration and notification delivery
- **Swagger Documentation**: Interactive API documentation with OpenAPI specification
- **Postman Collection**: Ready-to-use API testing collection included

### **Data Models & Database**
- **MongoDB Integration**: Flexible NoSQL database with Mongoose ODM for scalable data storage
- **Hierarchical Data Structure**: Efficient storage and retrieval of nested notes, tasks, and folders
- **Data Models**:
  - **User Accounts**: Secure user management with encrypted sensitive data
  - **Items Structure**: Notes, tasks, and folders with parent-child relationships
  - **Refresh Tokens**: Secure token management with automatic cleanup
  - **Device Management**: Push notification device registration
  - **Subscription Tracking**: Payment and subscription status management
- **Data Validation**: Express-validator for comprehensive input validation and sanitization

### **File Management & Security**
- **Secure Image Uploads**:
  - File type validation and size limits for security
  - Multer middleware for multipart form handling
  - Sharp image processing for metadata stripping and optimization
  - Virus scanning integration (ClamAV) for malicious content detection
- **Automated File Cleanup**: Cron jobs for removing orphaned and unused files
- **Organized Storage**: Systematic file organization with proper naming conventions

### **Push Notifications & Real-time Features**
- **Web Push Notifications**: Browser-based push notification support
- **Firebase Cloud Messaging (FCM)**: Mobile push notification delivery for Android apps
- **Socket.io Integration**: Real-time communication capabilities for live updates
- **Device Management**: Comprehensive device registration and subscription handling
- **Notification Scheduling**: Task reminder notifications with flexible scheduling

### **Payment & Subscription Management**
- **Paddle Integration**: Secure payment processing with webhook handling
- **Subscription Lifecycle**: Automated subscription management and billing
- **Revenue Tracking**: Payment analytics and subscription metrics
- **Beta Access Control**: Feature flags and beta user management

### **System Maintenance & Monitoring**
- **Automated Background Tasks**:
  - Scheduled cleanup of expired refresh tokens
  - Orphaned file removal and storage optimization
  - System health monitoring and alerts
- **Comprehensive Logging**:
  - Winston logging framework with multiple log levels
  - Error logging to files (error.log, combined.log)
  - Structured logging for easy monitoring and debugging
- **Health Monitoring**: Heartbeat endpoints for system status and uptime tracking

### **Administrative Features**
- **Admin Panel Endpoints**: Complete administrative user and system management
- **User Analytics**: Detailed user activity, engagement, and usage statistics
- **System Metrics**: Performance monitoring, API usage, and resource utilization
- **Beta Testing Support**: Beta user management, feature flags, and A/B testing capabilities

### **Testing & Quality Assurance**
- **Comprehensive Test Suite**:
  - Jest unit tests for individual components and functions
  - Integration tests for API endpoints and database operations
  - Supertest for HTTP endpoint testing
  - MongoDB Memory Server for isolated test environments
- **Test Coverage**: Detailed code coverage reporting and metrics
- **Continuous Integration**: Automated testing with GitHub Actions

---

## 🛠 **Technology Stack**

- **Framework**: Express.js 4.21.1 for robust web application framework
- **Database**: MongoDB with Mongoose 8.14.1 for flexible data modeling
- **Authentication**: JWT (jsonwebtoken) with bcrypt for secure user authentication
- **Security**: Helmet, express-rate-limit, CORS, express-mongo-sanitize, hpp, xss-clean
- **API Documentation**: Swagger (swagger-jsdoc, swagger-ui-express) for interactive documentation
- **File Handling**: Multer for uploads, Sharp for image processing
- **Push Notifications**: Firebase Admin SDK, web-push for browser notifications
- **Logging**: Winston for structured logging and monitoring
- **Scheduled Tasks**: node-cron for background job management
- **Payment Processing**: Paddle webhook integration
- **Testing**: Jest, Supertest, MongoDB Memory Server

---

## 📋 **Prerequisites**

- **Node.js**: Version 14 or higher
- **npm** (or Yarn)
- **MongoDB**: Running instance (local or cloud-based like MongoDB Atlas)

---

## 🚀 **Project Setup**

1. **Clone the repository:**
    ```bash
    git clone https://github.com/dushkin/My-Notes-and-Tasks-Backend.git
    cd My-Notes-and-Tasks-Backend
    ```

2. **Install dependencies:**
    ```bash
    npm install
    ```

3. **Create environment file:**
    Create a `.env` file in the root directory with the following required variables:

    ```env
    # Database connection
    MONGODB_URI=mongodb://localhost:27017/MyNotesAppDB

    # JWT configuration
    JWT_SECRET=your_super_secret_jwt_key_here
    JWT_EXPIRES_IN=15m
    REFRESH_TOKEN_EXPIRES_IN=7d

    # Server configuration
    PORT=5001
    NODE_ENV=development

    # CORS configuration
    ALLOWED_ORIGINS=http://localhost:5173

    # File upload limits
    MAX_FILE_SIZE=5242880
    UPLOAD_PATH=./uploads

    # Push notification keys (optional)
    VAPID_PUBLIC_KEY=your_vapid_public_key
    VAPID_PRIVATE_KEY=your_vapid_private_key
    VAPID_EMAIL=your_email@domain.com

    # Firebase configuration (optional, for FCM)
    FIREBASE_PROJECT_ID=your_firebase_project_id

    # Payment processing (optional)
    PADDLE_WEBHOOK_SECRET=your_paddle_webhook_secret
    ```

4. **Start the server:**
    ```bash
    # For development with auto-reloading
    npm run dev

    # For production
    npm start
    ```

The server will start on the port defined in your `.env` file (default: 5001).

---

## 📚 **API Documentation**

### **Interactive Documentation**
Once the server is running, access the comprehensive Swagger documentation at:
**http://localhost:5001/api-docs**

### **Postman Collection**
A complete Postman collection is included in the repository (`Notes_Tasks_API.postman_collection.json`) with:
- Pre-configured requests for all endpoints
- Environment variables for easy testing
- Authentication token management
- Example request/response data

### **Key API Endpoints**

#### **Authentication**
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User authentication
- `POST /api/auth/refresh` - Token refresh
- `POST /api/auth/logout` - User logout

#### **Items Management**
- `GET /api/items/tree` - Get complete hierarchical structure
- `POST /api/items` - Create new item (root level)
- `POST /api/items/:parentId` - Create item under parent
- `PATCH /api/items/:itemId` - Update item properties
- `DELETE /api/items/:itemId` - Delete item and children

#### **File Management**
- `POST /api/images/upload` - Secure image upload
- `GET /api/images/:filename` - Retrieve uploaded images
- `DELETE /api/images/:filename` - Delete uploaded images

#### **User Management**
- `GET /api/account/profile` - Get user profile
- `PATCH /api/account/profile` - Update user profile
- `DELETE /api/account` - Delete user account

---

## 🧪 **Testing**

Run the comprehensive test suite:

```bash
# Run all tests
npm test

# Run tests with coverage
npm run test:coverage

# Run only unit tests
npm run test:unit

# Run only integration tests
npm run test:integration

# Run tests in watch mode
npm run test:watch
```

---

## 🔗 **Related Repositories**

- **Frontend Application**: [My-Notes-and-Tasks](https://github.com/dushkin/My-Notes-and-Tasks) - Complete React frontend with comprehensive feature overview
- **Backend API**: [My-Notes-and-Tasks-Backend](https://github.com/dushkin/My-Notes-and-Tasks-Backend) (this repository)

---

## 📄 **License**

This project is licensed under the **CC BY-ND 4.0 License**. See the `LICENSE` file for details.

---

## 👤 **Author**

**TT** © 2025

---

## 🤝 **Contributing**

Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines on how to contribute to this project.
