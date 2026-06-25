import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

import * as dotenv from 'dotenv';

// Get current directory for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment from root .env.local
const projectRoot = resolve(__dirname);
const envPath = resolve(projectRoot, '.env.local');

// Load environment variables
const result = dotenv.config({ path: envPath });
if (result.parsed) {
  console.log(`✓ Loaded environment from ${envPath}`);
}

/** @type {import('jest').Config} */
const config = {
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  globalSetup: '<rootDir>/scripts/globalSetup.ts',
  globalTeardown: '<rootDir>/scripts/globalTeardown.ts',
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
  roots: ['<rootDir>'],
  testMatch: ['<rootDir>/**/__tests__/**/*.ts?(x)'],
  // Performance optimizations
  maxWorkers: '50%', // Use 50% of available CPU cores
  workerIdleMemoryLimit: '512MB', // Limit memory per worker
  silent: process.env.DEBUG_TEST === 'false',
  transform: {
    '^.+\\.(ts|tsx)$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.json',
        useESM: false,
        // Enable Babel processing (uses root babel.config.js with react preset) so JSX in
        // collected coverage files is always parsed correctly, avoiding syntax errors
        // when ts-jest falls back to Babel for instrumentation.
        babelConfig: true,
        diagnostics: {
          ignoreCodes: [1343],
        },
      },
    ],
  },
  transformIgnorePatterns: ['/node_modules/(?!(@testing-library|@babel|@jest|@types)/)'],
  collectCoverage: true,
  coverageProvider: 'v8',
  coverageDirectory: 'coverage',
  // Optimize coverage collection
  coverageReporters: ['lcov', 'text', 'html'],
  collectCoverageFrom: [
    // Core token + invite system (explicit files we always want counted)
    'packages/prism/src/core/**/*.ts',
    // Retain broader app/API & feature coverage we previously counted (needed for overall quality metrics)
    'apps/interface/src/app/api/**/*.ts',
    'apps/dashboard/src/app/api/**/*.ts',
    'apps/interface/src/app/middleware/**/*.ts',
    'apps/dashboard/src/app/middleware/**/*.ts',
    'apps/interface/src/features/**/actions/**/*.ts',
    'apps/interface/src/features/**/services/**/*.ts',
    'apps/interface/src/features/**/lib/**/*.ts',
    'apps/interface/src/features/**/routes/**/*.ts',
    'apps/interface/src/features/**/components/**/*.tsx',
    'apps/interface/src/contexts/**/*.tsx',
    // mesh
    'apps/mesh/src/api/**/*.ts',
    'apps/mesh/src/middleware/**/*.ts',
    'apps/mesh/src/resolvers/**/*.ts',
    'apps/mesh/src/services/**/*.ts',
    // Keep core actions/auth blocks we can exercise (light trimming vs original massive list)
    'packages/prism/src/core/actions/*.ts',
    'packages/prism/src/core/auth/*.ts',
    'packages/prism/src/core/blocks/*.ts',
    // Exclusions (unchanged / conservative)
    '!apps/interface/src/features/**/__tests__/**',
    '!apps/interface/__tests__/**',
    '!apps/dashboard/__tests__/**',
    '!apps/mesh/__tests__/**',
    '!**/*.d.ts',
    '!**/node_modules/**',
    '!**/migration/**',
    '!**/scripts/**',
    '!**/dist/**',
    '!**/coverage/**',
    '!**/.next/**',
    '!**/build/**',
    '!<rootDir>/jest.config.mjs',
    '!**/jest.setup.ts',
    '!**/globalSetup.ts',
    '!**/globalTeardown.ts',
    '!**/layout.ts',
    '!**/layout.tsx',
  ],
  moduleNameMapper: {
    '^@interface/(.*)$': '<rootDir>/apps/interface/src/$1',
    '^@dashboard/(.*)$': '<rootDir>/apps/dashboard/src/$1',
    '^@nia/features$': '<rootDir>/packages/features/src/index.ts',
    '^@nia/features/(.*)$': '<rootDir>/packages/features/src/$1',
    '^@nia/prism$': '<rootDir>/packages/prism/src/index.ts',
    '^@nia/prism/(.*)$': '<rootDir>/packages/prism/src/$1',
    // Map style imports to a stub so CSS files don't break tests
    '\\.(css|less|sass|scss)$': '<rootDir>/tests/__mocks__/styleMock.js',
  },
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/load-tests/'],
  // No special path ignores needed for test helpers
  modulePathIgnorePatterns: [],
  // Increased global test timeout to 90 seconds to reduce intermittent timeouts in full suite runs
  testTimeout: 90000,
  verbose: false, // Reduce console output
  // Cache optimizations
  cache: true,
  cacheDirectory: '<rootDir>/.jest-cache',
  // Parallel test execution
  bail: false, // Don't bail on first failure
  // Reduce memory usage
  maxConcurrency: 4,
};

export default config;
