// middleware/securityHeadersMiddleware.js
import helmet from 'helmet';

console.log('[CSP Middleware] FORCED IMG-SRC ALLOW localhost:5001');

const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      imgSrc: ["'self'", "data:", "https:", "http://localhost:5001"],
      fontSrc: ["'self'", "data:"],
      connectSrc: ["'self'", "http://localhost:5001"],
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