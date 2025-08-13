# Sync Operations Server-Side Validation

## Overview

This document describes the comprehensive server-side validation implemented for all sync operations in the Notes & Tasks application. The validation system ensures data integrity, security, and prevents malicious attacks.

## Validation Layers

### 1. Input Schema Validation (`utils/syncValidation.js`)

#### Device Registration
- **Device ID**: Required, string, 1-128 characters, alphanumeric + hyphens/underscores only
- **Device Name**: Required, string, 1-100 characters, HTML escaped
- **Device Type**: Required, enum: `['iOS', 'Android', 'macOS', 'Windows', 'Linux', 'Unknown']`
- **Platform**: Optional, string, max 50 characters
- **User Agent**: Optional, string, max 500 characters
- **Capabilities**: Object with boolean values for known capabilities only

#### Sync Trigger
- **Device ID**: Optional, string, 1-128 characters, alphanumeric + hyphens/underscores
- **Data Type**: Optional, enum: `['all', 'notes', 'settings', 'reminders']`

#### Push Notifications
- **Endpoint**: Required, valid HTTPS URL, max 1000 characters
- **Keys**: Required object with `p256dh` and `auth` string keys (1-200 characters each)

### 2. Security Middleware (`middleware/syncSecurityMiddleware.js`)

#### Request Size Validation
- **Maximum Request Size**: 5MB for sync operations
- **Prevents**: DoS attacks via large payloads

#### Data Structure Validation
- **Maximum Nesting Depth**: 10 levels for JSON objects
- **Maximum Array Size**: 1000 items per array
- **Prevents**: Resource exhaustion attacks

#### Timestamp Validation
- **Valid Format**: ISO 8601 timestamps required
- **Time Range**: Max 2 years in past, 1 day in future
- **Prevents**: Time-based attacks and data corruption

#### Permission Validation
- **Account Verification**: Required for all sync operations
- **Subscription Status**: Optional enforcement via environment variable
- **User Session**: Valid authentication token required

#### Rate Limiting
- **Default Limits**: 100 requests per 15 minutes per user
- **Sync Frequency**: Minimum 30 seconds between sync trigger requests
- **Prevents**: API abuse and DoS attacks

#### Security Headers
- **Cache Control**: `no-store, no-cache, must-revalidate`
- **Content Security**: `X-Content-Type-Options: nosniff`
- **Frame Options**: `X-Frame-Options: DENY`
- **XSS Protection**: `X-XSS-Protection: 1; mode=block`

### 3. Data Sanitization

#### Device Information
- **HTML Tag Removal**: Strips all HTML tags from device names/platforms
- **Dangerous Character Filtering**: Removes `<>'"&` characters
- **Whitespace Trimming**: Removes leading/trailing spaces

#### Content Validation
- **XSS Prevention**: Input sanitization and output encoding
- **SQL Injection Prevention**: Parameterized queries with Mongoose
- **NoSQL Injection Prevention**: Data type validation

## Endpoints Protected

### Sync Routes (`/api/sync/*`)
1. `POST /api/sync/devices/register` - Device registration with full validation
2. `POST /api/sync/devices/activity` - Device activity updates
3. `POST /api/sync/trigger` - Manual sync triggers with rate limiting
4. `GET /api/sync/status` - Sync status queries
5. `GET /api/sync/devices` - Device list retrieval

### Push Notification Routes (`/api/push/*`)
1. `POST /api/push/subscribe` - Push subscription with endpoint validation
2. `POST /api/push/test` - Test notifications with message validation

## Error Response Format

All validation errors return consistent JSON responses:

```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [
    {
      "field": "fieldName",
      "message": "Specific error message",
      "value": "invalid value (if safe to show)"
    }
  ]
}
```

## Rate Limiting Details

### Sync Operations
- **Window**: 15 minutes
- **Limit**: 100 requests per user
- **Reset**: Sliding window
- **Error Code**: 429 Too Many Requests

### Sync Trigger Specific
- **Minimum Interval**: 30 seconds between requests
- **Tracking**: In-memory per user
- **Cleanup**: Automatic cleanup of expired entries

## Security Features

### Authentication
- **JWT Token**: Required for all protected endpoints
- **User Verification**: Account must be verified
- **Session Validation**: Token expiry and signature validation

### Authorization
- **User Context**: All operations scoped to authenticated user
- **Subscription Checks**: Optional premium feature gating
- **Device Ownership**: Devices linked to user accounts

### Data Protection
- **Encryption**: Sensitive data encrypted at rest
- **Transport Security**: HTTPS required for all endpoints
- **Input Validation**: Multi-layer validation prevents injection

### Attack Prevention
- **XSS Protection**: Input sanitization and CSP headers
- **CSRF Protection**: SameSite cookies and token validation
- **DoS Protection**: Request size limits and rate limiting
- **Injection Prevention**: Parameterized queries and type checking

## Testing

Comprehensive test suite covers:
- Valid input acceptance
- Invalid input rejection
- Edge case handling
- Security boundary testing
- Authentication/authorization
- Rate limiting behavior
- Data sanitization
- Error response format

Test file: `tests/validation/syncValidation.test.js`

## Configuration

### Environment Variables
- `SYNC_REQUIRES_SUBSCRIPTION`: Enable subscription requirement
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`: Push notification keys
- `JWT_SECRET`: Token signing secret
- `DATA_ENCRYPTION_SECRET`: Data encryption key

### Rate Limit Configuration
```javascript
// In routes/syncRoutes.js
router.use(syncRateLimit(100, 15)); // 100 requests per 15 minutes
router.use(validateSyncRequestSize(5 * 1024 * 1024)); // 5MB max
```

## Monitoring and Logging

All validation failures are logged with:
- User ID
- Endpoint accessed
- Validation errors
- Request metadata
- Timestamp

Log level: `WARN` for validation failures, `ERROR` for security violations

## Maintenance

### Regular Tasks
1. Monitor rate limit effectiveness
2. Review validation rules for new attack vectors
3. Update device type enums as needed
4. Analyze failed validation patterns
5. Performance impact assessment

### Version Compatibility
- Validation rules designed for backward compatibility
- Optional fields allow gradual client updates
- Error responses include helpful guidance

## Future Enhancements

1. **Dynamic Rate Limiting**: Adjust limits based on user behavior
2. **Geolocation Validation**: Verify device locations for security
3. **Behavioral Analysis**: Detect unusual sync patterns
4. **Advanced Sanitization**: Content-aware data cleaning
5. **Audit Logging**: Comprehensive security event tracking