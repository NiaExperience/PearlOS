/**
 * Jest configuration for performance testing with industry-standard reporters
 */
import baseConfig from './jest.config.mjs';

export default {
  ...baseConfig,
  // Enable performance timing
  verbose: true,
  // Early instrumentation before test framework env (function wrapping only)
  setupFiles: [
    '<rootDir>/scripts/jest-performance-instrumentation.cjs'
  ],
  
  // Industry-standard reporters
  reporters: [
    'default',
    
    // JUnit XML for CI/CD integration
    ['jest-junit', {
      outputDirectory: './performance-reports',
      outputName: 'junit-performance.xml',
      includeConsoleOutput: true,
      includeShortConsoleOutput: true,
    }],
    
    // Performance-specific reporter
    '<rootDir>/scripts/jest-performance-reporter.js'
  ],
  
  // Collect timing data
  collectCoverage: false, // Disable for pure performance runs
  maxWorkers: 1, // Single worker for consistent timing
  
  // Environment setup for performance monitoring
  setupFilesAfterEnv: [
    '<rootDir>/jest.setup.ts',
    '<rootDir>/scripts/jest-performance-setup.js'
  ],
};
