// middleware/securityHeadersMiddleware.js
import helmet from 'helmet';

const securityHeaders = helmet({
  // Content Security Policy - Critical for preventing XSS through uploaded images
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"], // Allow inline styles
      scriptSrc: ["'self'"], // Only allow scripts from same origin
      
      // Image sources - crucial for image upload security
      imgSrc: [
        "'self'", 
        "data:", // Allow data URLs for base64 images
        "blob:", // Allow blob URLs for client-side image processing
        "https:", // Allow HTTPS images (but not HTTP)
        // Add your specific domains if needed:
        // "https://yourdomain.com",
        // "https://*.yourdomain.com"
      ],
      
      fontSrc: ["'self'", "data:"],
      connectSrc: ["'self'"], // API calls only to same origin
      mediaSrc: ["'self'"], // Audio/video only from same origin
      frameSrc: ["'none'"], // No frames/iframes allowed
      objectSrc: ["'none'"], // No plugins (Flash, etc.)
      baseUri: ["'self'"], // Prevent base tag injection
      formAction: ["'self'"], // Forms can only submit to same origin
      
      // Prevent embedding in frames (clickjacking protection)
      frameAncestors: ["'none'"],
      
      // Only upgrade to HTTPS in production
      ...(process.env.NODE_ENV === 'production' && {
        upgradeInsecureRequests: true
      })
    }
  },

  // CORP - Important for image uploads from different origins
  crossOriginEmbedderPolicy: false, // Set to false for image upload compatibility

  // HSTS - Force HTTPS (production only)
  hsts: process.env.NODE_ENV === 'production' ? {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true
  } : false,

  // Prevent MIME type sniffing - Critical for file upload security
  noSniff: true,

  // X-Frame-Options - Prevent clickjacking
  frameguard: { 
    action: 'deny' // Don't allow page to be framed
  },

  // XSS Protection (legacy browsers)
  xssFilter: true,

  // Referrer Policy - Control referrer information
  referrerPolicy: { 
    policy: ['same-origin', 'strict-origin-when-cross-origin']
  },

  // Permissions Policy - Control browser features
  permissionsPolicy: {
    camera: ['self'], // Allow camera for image capture
    microphone: [], // Deny microphone
    geolocation: [], // Deny location
    payment: [], // Deny payment APIs
    usb: [], // Deny USB access
    bluetooth: [], // Deny Bluetooth
  },

  // DNS Prefetch Control
  dnsPrefetchControl: {
    allow: false // Prevent DNS prefetching
  },

  // Hide server information
  hidePoweredBy: true,

  // Expect-CT header (for certificate transparency)
  expectCt: process.env.NODE_ENV === 'production' ? {
    maxAge: 86400, // 24 hours
    enforce: true
  } : false
});

export default securityHeaders;