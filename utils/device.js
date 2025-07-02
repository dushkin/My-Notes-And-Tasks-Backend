// utils/device.js
/**
 * Extract device information from the request object.
 * @param {object} req - Express request object.
 * @returns {{ userAgent: string, ip: string }}
 */
export function getDeviceInfo(req) {
  // User-Agent header for client identification
  const userAgent = req.headers['user-agent'] || '';

  // IP address detection, considering proxies
  let ip = '';
  if (req.headers['x-forwarded-for']) {
    // 'x-forwarded-for' may return a comma-separated list of IPs
    ip = req.headers['x-forwarded-for'].split(',').pop().trim();
  }
  // Fallback to remote address if not behind a proxy
  if (!ip && req.socket && req.socket.remoteAddress) {
    ip = req.socket.remoteAddress;
  }

  return { userAgent, ip };
}
