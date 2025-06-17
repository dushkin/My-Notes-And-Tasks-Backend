# Notes & Tasks - Backend API

This repository contains the source code for the backend REST API that powers the [Notes & Tasks application](https://github.com/your-username/your-frontend-repo). It is a secure, robust, and scalable service built with Node.js, Express, and MongoDB.

**[View API Documentation](http://localhost:5001/api-docs)** (while running locally)

---

## Key Features

* [cite_start]**Secure JWT Authentication:** Implements a robust authentication strategy using signed JSON Web Tokens (JWT) with both access and refresh tokens for enhanced security. [cite_start]Passwords are never stored in plaintext and are securely hashed using `bcrypt`.
* [cite_start]**Automated API Documentation:** The entire API is documented using `swagger-jsdoc`. [cite_start]When the server is running, you can access an interactive Swagger UI to explore and test all endpoints.
* **Advanced Security Middleware:** The application is hardened with multiple layers of security, including:
    * [cite_start]`helmet` for protection against common web vulnerabilities.
    * [cite_start]Rate limiting to prevent brute-force attacks on authentication and other endpoints.
    * [cite_start]`cors` for configurable Cross-Origin Resource Sharing.
    * [cite_start]Input sanitization to protect against NoSQL injection and XSS attacks.
* [cite_start]**Secure Image Uploads:** Features a dedicated image upload endpoint that validates file types, limits sizes, and processes images with `sharp` to strip potentially malicious metadata before saving.
* [cite_start]**Automated Background Jobs:** Uses `node-cron` to run scheduled tasks for system maintenance, such as:
    * [cite_start]Cleaning up orphaned image files that are no longer referenced in any notes.
    * [cite_start]Periodically purging expired and revoked refresh tokens from the database.
* [cite_start]**Comprehensive Logging & Error Handling:** Implements `winston` for detailed, level-based logging to both the console and log files (`error.log`, `combined.log`). [cite_start]Features a global error handling middleware to ensure all errors are caught and logged consistently.

## Technology Stack

* [cite_start]**Framework:** Express.js 
* [cite_start]**Database:** MongoDB with Mongoose 
* [cite_start]**Authentication:** JWT (jsonwebtoken), bcrypt 
* [cite_start]**Security:** Helmet, express-rate-limit, CORS, express-mongo-sanitize, hpp, xss-clean 
* [cite_start]**API Documentation:** Swagger (swagger-jsdoc, swagger-ui-express) 
* [cite_start]**File Handling:** Multer, Sharp 
* [cite_start]**Logging:** Winston 
* [cite_start]**Scheduled Tasks:** node-cron 

## Project Setup

*(These instructions are based on your project's `package.json` and file structure)*

1.  **Install Dependencies:**
    ```bash
    npm install
    ```

2.  **Create Environment File:**
    Create a `.env` file in the root directory. You can copy the contents of `.env.example` if one exists, or create it from scratch with the following required variables:

    ```env
    # The connection string for your MongoDB database
    MONGODB_URI=mongodb://localhost:27017/MyNotesAppDB

    # A strong, secret string for signing JWTs
    JWT_SECRET=your_super_secret_jwt_key_here

    # The port for the backend server to run on
    PORT=5001

    # Comma-separated list of allowed origins for the frontend app
    ALLOWED_ORIGINS=http://localhost:5173
    ```

3.  **Run the Server:**
    ```bash
    # For development with auto-reloading
    npm run dev

    # For production
    npm start
    ```
The server will start on the port defined in your `.env` file (e.g., 5001).

## License

This project is licensed under the **CC BY-ND 4.0 License**. See the `LICENSE` file for details.