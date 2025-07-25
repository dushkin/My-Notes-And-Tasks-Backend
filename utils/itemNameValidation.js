const FORBIDDEN_CHARS = [
  '/', '\\',     // Path separators (could interfere with URL routing)
  '<', '>',     // HTML tags (XSS prevention)
  '|',          // Pipe character (could interfere with shell commands)
  '\0',         // Null character
  '\r', '\n',   // Line breaks (could cause display issues)
  '\t'          // Tabs (could cause formatting issues)
];

/**
 * Validates an item name and returns validation result
 * @param {string} name - The item name to validate
 * @param {object} options - Validation options
 * @returns {object} - {isValid: boolean, error: string|null}
 */
export function validateItemName(name, options = {}) {
  const { maxLength = 255 } = options;

  // Basic checks
  if (typeof name !== 'string') {
    return { isValid: false, error: 'Name must be a string' };
  }

  const trimmed = name.trim();
  
  if (!trimmed) {
    return { isValid: false, error: 'Name cannot be empty' };
  }

  if (trimmed.length > maxLength) {
    return { 
      isValid: false, 
      error: `Name cannot exceed ${maxLength} characters`
    };
  }

  // Check for forbidden characters
  const foundForbiddenChar = FORBIDDEN_CHARS.find(char => trimmed.includes(char));
  if (foundForbiddenChar) {
    const charName = getCharacterName(foundForbiddenChar);
    return { 
      isValid: false, 
      error: `Name cannot contain ${charName}` 
    };
  }

  // Check for leading/trailing periods (can cause issues on some systems)
  if (trimmed.startsWith('.') || trimmed.endsWith('.')) {
    return { 
      isValid: false, 
      error: 'Name cannot start or end with a period' 
    };
  }

  // Check for reserved names (Windows system names)
  const upperName = trimmed.toUpperCase();
  const reservedNames = ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9', 'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'];
  if (reservedNames.includes(upperName)) {
    return { 
      isValid: false, 
      error: `"${trimmed}" is a reserved system name` 
    };
  }

  return { isValid: true, error: null };
}

/**
 * Gets a human-readable name for a character
 * @param {string} char - The character
 * @returns {string} - Human-readable name
 */
function getCharacterName(char) {
  const charNames = {
    '/': 'forward slash (/)',
    '\\': 'backslash (\\)',
    '<': 'less than sign (<)',
    '>': 'greater than sign (>)',
    '|': 'pipe character (|)',
    ':': 'colon (:)',
    '*': 'asterisk (*)',
    '?': 'question mark (?)',
    '"': 'quotation mark (")',
    '\0': 'null character',
    '\r': 'carriage return',
    '\n': 'line break',
    '\t': 'tab character'
  };
  return charNames[char] || `"${char}"`;
}

// Middleware for Express routes
export function validateItemNameMiddleware(req, res, next) {
  const { label } = req.body;
  
  // Only validate if label is present in the request
  if (!label && !req.body.hasOwnProperty('label')) {
    return next(); // No label field to validate
  }
  
  if (!label) {
    return res.status(400).json({ error: 'Label cannot be empty' });
  }

  const validation = validateItemName(label);

  if (!validation.isValid) {
    return res.status(400).json({ error: validation.error });
  }

  // Update with trimmed version
  req.body.label = label.trim();
  next();
}