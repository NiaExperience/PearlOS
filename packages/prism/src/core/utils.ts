import { clsx, type ClassValue } from "clsx";
import { SignJWT } from "jose";
import { twMerge } from "tailwind-merge";
import { validate as uuidValidate } from 'uuid';
import { z } from 'zod';
import { getLogger } from './logger';

const logger = getLogger('prism:utils');

// Accept RFC4122 compliant UUIDs (v1-v5) and tolerate padded / partially zeroed last segment used in legacy ObjectId mapping.
// The built-in uuidValidate should succeed; if it does not, attempt a relaxed regex that still enforces 8-4-4-4-12 hex.
export function isValidUUID(uuid: string): boolean {
  if (typeof uuid !== 'string') return false;
  if (uuidValidate(uuid)) return true;
  // Fallback: some legacy transformed IDs may have non-standard version nibble (7) produced by objectIdToUUID padding.
  // We still want to treat them as identifiers but avoid passing obviously malformed strings to DB casts.
  const relaxed = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  return relaxed.test(uuid);
}

export function isValidPhoneNumber(phoneNumber: string): boolean {

  const phoneNumberRegex = /^((\+?[1-9]\d{1,14})|(\d{10}))$/;

  const schema = z.object({
    phoneNumber: z.string().regex(phoneNumberRegex, "Invalid phone number format"),
  });

  const result = schema.safeParse({ phoneNumber: phoneNumber });
  if (result.success) {
    return true;
  } else {
    return false;
  }
}


export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

type ErrorType = {
  message: string
  cause?: unknown
  statusCode?: number
}

export const handleError = (error: unknown) => {
  const errorObject: ErrorType = {
    message: 'An unknown error occurred',
    statusCode: 404,
  }

  if (error instanceof Error) {
    errorObject.message = error.message
    // Only assign cause if it exists on the error object
    if ('cause' in error) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      errorObject.cause = (error as any).cause
    }
  } else if (typeof error === 'string') {
    errorObject.message = error
  }

  // Log the error
  logger.error('Error', {
    message: errorObject.message,
    cause: errorObject.cause,
    stack: error instanceof Error ? error.stack : undefined,
    timestamp: new Date().toISOString(),
  })

  // You could also add different behavior based on the environment
  if (process.env.NODE_ENV === 'development') {
    logger.debug('Detailed error', {
      error: error instanceof Error ? error.message : error,
    })
  }

  return errorObject
}

// Usage example:
try {
  // Your code here
} catch (error) {
  handleError(error)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function generateToken(payload: any) {
  const token = new SignJWT(payload)
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('24h')
      .sign(new TextEncoder().encode(process.env.JWT_SECRET))
  return token
}

// --- Security Utilities (from utils/security.ts) ---
/**
 * Sanitize URL to remove any credential parameters
 */
export function sanitizeUrl(url: string): string {
  try {
    const cleanUrl = new URL(url);
    // Remove sensitive parameters
    cleanUrl.searchParams.delete('email');
    cleanUrl.searchParams.delete('password');
    cleanUrl.searchParams.delete('credentials');
    cleanUrl.searchParams.delete('token');
    cleanUrl.searchParams.delete('auth');
    return cleanUrl.toString();
  } catch (error) {
    // If URL parsing fails, return original URL
    return url;
  }
}

/**
 * Sanitize object to remove sensitive fields for logging
 */
export function sanitizeForLogging(obj: unknown): unknown {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return obj;
  }

  const sanitized = { ...obj as Record<string, unknown> };
  const sensitiveFields = ['password', 'email', 'credentials', 'token', 'auth', 'secret'];

  sensitiveFields.forEach(field => {
    if (sanitized[field]) {
      sanitized[field] = '[REDACTED]';
    }
  });

  return sanitized;
}

/**
 * Validate that a URL doesn't contain sensitive parameters
 */
export function validateUrlSecurity(url: string): boolean {
  try {
    const urlObj = new URL(url);
    const sensitiveParams = ['email', 'password', 'credentials', 'token', 'auth', 'secret'];
    
    return !sensitiveParams.some(param => urlObj.searchParams.has(param));
  } catch (error) {
    return false;
  }
}

/**
 * Ensure form data doesn't contain credentials in URL
 */
export function validateFormSecurity(formData: FormData): boolean {
  const sensitiveFields = ['email', 'password', 'credentials', 'token', 'auth', 'secret'];
  
  return !sensitiveFields.some(field => {
    const value = formData.get(field);
    return value && typeof value === 'string' && value.length > 0;
  });
}

export function objectIdToUUID(data: unknown): string[] | string {
  let buffers;
  if (!Array.isArray(data)) {
    buffers = [data];
  } else {
    buffers = data;
  }

  const collection = buffers.map(obj => {
    // Types.ObjectId may not be available here, so check for toString method
    let uuid = '';
    if (obj && typeof obj === 'string' && obj.length === 24) {
      uuid = obj;
    } else if (obj && typeof obj === 'object' && typeof (obj as { toString: () => string }).toString === 'function' && (obj as { toString: () => string }).toString().length === 24) {
      uuid = (obj as { toString: () => string }).toString();
    } else {
      return obj as string;
    }
    
    while (uuid.length < 32) {
      uuid += '0';
    }
    uuid = `${uuid.slice(0, 8)}-${uuid.slice(8, 12)}-${uuid.slice(12, 16)}-${uuid.slice(16, 20)}-${uuid.slice(20)}`;
    return uuid;
  });

  if (!Array.isArray(data)) {
    return collection[0];
  }
  return collection;
}

// NOTE: MongoDB-dependent functions (transformMongoObjects, objectIdToUuid) 
// have been moved to the migration script to avoid pulling MongoDB 
// dependencies into frontend builds.

export function transformAssistantIdKeys(obj: unknown): unknown {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    const transformed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (key === 'assistantId' && typeof value === 'string') {
        transformed.assistant_id = value;
      } else if (key === 'assistant_id' && typeof value === 'string') {
        transformed.assistantId = value;
      } else {
        transformed[key] = transformAssistantIdKeys(value);
      }
    }
    return transformed;
  } else if (Array.isArray(obj)) {
    return obj.map(transformAssistantIdKeys);
  }
  return obj;
}

export function safeRevalidatePath(path: string): void {
  try {
    // This would be used in Next.js to revalidate a path
    // For now, just log the path
    logger.info('Revalidating path', { path });
  } catch (error) {
    logger.error('Error revalidating path', {
      error: error instanceof Error ? error.message : String(error),
      path,
    });
  }
}
