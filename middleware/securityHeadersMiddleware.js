// middleware/securityHeadersMiddleware.js
import helmet from 'helmet';

console.log('[CSP Middleware] FORCED IMG-SRC ALLOW localhost:5001');

const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",
        "'unsafe-eval'",
        "https://cdn.paddle.com",
        "https://cdn.jsdelivr.net",
        "http://cdn.jsdelivr.net",
        "https://www.googletagmanager.com",
        "https://unpkg.com",
        "https://connect.facebook.net"
      ],
      imgSrc: ["'self'", "data:", "https:", "http://localhost:5001"],
      fontSrc: ["'self'", "data:"],
      connectSrc: [
        "'self'",
        "http://localhost:5001",
        "ws://localhost:5001",
        "wss://my-notes-and-tasks-backend-dev.onrender.com",
        "wss://my-notes-and-tasks-backend.onrender.com",
        "https://my-notes-and-tasks-backend.onrender.com",
        "https://checkout.paddle.com",
        "https://checkout-service.paddle.com",
        "https://sandbox-checkout-service.paddle.com",
        "https://cdn.paddle.com",
        "https://sandbox-cdn.paddle.com",
        "http://cdn.jsdelivr.net",
        "https://cdn.jsdelivr.net",
        "https://play.google.com",
        "https://www.google-analytics.com",
        "https://analytics.google.com",
        "https://www.googletagmanager.com"
      ],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    }
  },
  crossOriginEmbedderPolicy: false,
  hsts: false,
  noSniff: true,
  frameguard: { action: 'deny' },
  xssFilter: true,
  referrerPolicy: { policy: ['same-origin', 'strict-origin-when-cross-origin'] },
  permissionsPolicy: {
    camera: ['self'],
    microphone: [],
    geolocation: [],
    payment: [],
    usb: [],
    bluetooth: [],
  },
  dnsPrefetchControl: { allow: false },
  hidePoweredBy: true,
  expectCt: false
});

export default securityHeaders;