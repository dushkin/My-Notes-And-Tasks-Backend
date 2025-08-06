import { JSDOM } from 'jsdom';
import createDOMPurify from 'dompurify';

// Create a JSDOM window for server-side DOMPurify
const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);

/**
 * Sanitizes HTML content to prevent XSS attacks
 * @param {string} content - The content to sanitize
 * @returns {string} - The sanitized content
 */
export const sanitizeContent = (content) => {
  if (typeof content !== 'string') {
    return content;
  }
  
  // Configure DOMPurify to allow common HTML tags but remove dangerous ones
  const sanitized = DOMPurify.sanitize(content, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'a', 'img'],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'id'],
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'textarea', 'button'],
    FORBID_ATTR: ['onclick', 'onload', 'onerror', 'onmouseover', 'onfocus', 'onblur'],
    KEEP_CONTENT: true // Keep content even if tags are removed
  });
  
  // Manually encode any remaining > characters to ensure consistency
  return sanitized.replace(/>/g, '&gt;');
};