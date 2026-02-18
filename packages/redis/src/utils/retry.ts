/**
 * Retry utilities for Redis operations
 * Provides exponential backoff and circuit breaker patterns
 */

/**
 * Retry configuration options
 */
export interface RetryOptions {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  jitter: boolean;
}

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelay: 100,
  maxDelay: 5000,
  backoffMultiplier: 2,
  jitter: true
};

/**
 * Retry operation result
 */
export interface RetryResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
  attempts: number;
  totalTime: number;
}

/**
 * Execute a function with exponential backoff retry
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<RetryResult<T>> {
  const config = { ...DEFAULT_RETRY_OPTIONS, ...options };
  const startTime = Date.now();
  let lastError: Error | undefined;
  
  for (let attempt = 1; attempt <= config.maxRetries + 1; attempt++) {
    try {
      const result = await operation();
      
      return {
        success: true,
        data: result,
        attempts: attempt,
        totalTime: Date.now() - startTime
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // Don't retry on the last attempt
      if (attempt > config.maxRetries) {
        break;
      }
      
      // Calculate delay with exponential backoff
      const delay = calculateDelay(attempt - 1, config);
      await sleep(delay);
    }
  }
  
  return {
    success: false,
    error: lastError,
    attempts: config.maxRetries + 1,
    totalTime: Date.now() - startTime
  };
}

/**
 * Calculate exponential backoff delay
 */
function calculateDelay(attempt: number, options: RetryOptions): number {
  let delay = options.baseDelay * Math.pow(options.backoffMultiplier, attempt);
  
  // Cap at max delay
  delay = Math.min(delay, options.maxDelay);
  
  // Add jitter to prevent thundering herd
  if (options.jitter) {
    delay = delay * (0.5 + Math.random() * 0.5);
  }
  
  return Math.floor(delay);
}

/**
 * Sleep for the specified number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Circuit breaker state
 */
export enum CircuitState {
  CLOSED = 'closed',
  OPEN = 'open',
  HALF_OPEN = 'half_open'
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerOptions {
  failureThreshold: number;
  resetTimeout: number;
  monitoringPeriod: number;
}

/**
 * Simple circuit breaker implementation
 */
export class CircuitBreaker {
  private state = CircuitState.CLOSED;
  private failures = 0;
  private lastFailureTime = 0;
  private successCount = 0;
  
  constructor(private options: CircuitBreakerOptions) {}
  
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (Date.now() - this.lastFailureTime < this.options.resetTimeout) {
        throw new Error('Circuit breaker is OPEN');
      }
      this.state = CircuitState.HALF_OPEN;
    }
    
    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
  
  private onSuccess(): void {
    this.failures = 0;
    this.successCount++;
    
    if (this.state === CircuitState.HALF_OPEN) {
      this.state = CircuitState.CLOSED;
    }
  }
  
  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();
    
    if (this.failures >= this.options.failureThreshold) {
      this.state = CircuitState.OPEN;
    }
  }
  
  getState(): CircuitState {
    return this.state;
  }
  
  getStats(): {
    state: CircuitState;
    failures: number;
    successCount: number;
  } {
    return {
      state: this.state,
      failures: this.failures,
      successCount: this.successCount
    };
  }
}

/**
 * RetryManager class wrapper for retry operations
 */
export class RetryManager {
  async execute<T>(operation: () => Promise<T>, options?: Partial<RetryOptions>): Promise<{ result: T; attempts: number }> {
    const retryResult = await withRetry(operation, options);
    if (retryResult.success && retryResult.data !== undefined) {
      return { result: retryResult.data, attempts: retryResult.attempts };
    }
    throw retryResult.error || new Error('Operation failed after retries');
  }
}