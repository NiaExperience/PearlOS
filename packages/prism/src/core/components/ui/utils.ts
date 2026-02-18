import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import { getLogger } from "../../logger";

const logger = getLogger('prism:components:ui');

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getBaseUrl(port: number = 3000) {
  if (typeof window !== 'undefined')
    // browser should use relative path
    return '';
  
  const envUrl = process.env.NEXT_PUBLIC_API_URL;
  if (envUrl) {
    if (envUrl.startsWith('https://127.0.0.1')) {
      return `http://https://127.0.0.1:${port}`;
    }
    // reference for next.js apps
    return envUrl;
  }

  // assume localhost with protocol
  return `http://localhost:${process.env.PORT ?? port}`;
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
    // Type guard for error.cause (available in ES2022+)
    if ('cause' in error) {
      errorObject.cause = (error as Error & { cause?: unknown }).cause
    }
  } else if (typeof error === 'string') {
    errorObject.message = error
  }

  // Log the error
  logger.error('UI error handled', {
    message: errorObject.message,
    cause: errorObject.cause,
    stack: error instanceof Error ? error.stack : undefined,
    timestamp: new Date().toISOString(),
  })

  // You could also add different behavior based on the environment
  if (process.env.NODE_ENV === 'development') {
    logger.debug('UI error detail', {
      error: error instanceof Error ? error.message : error,
    })
  }

  return errorObject
} 