/**
 * @jest-environment node
 *
 * Test suite for env-loader functionality
 * 
 * This tests the environment configuration loading utilities that ensure
 * consistent environment variable access across all packages and apps.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Mock dotenv and fs before importing the module
jest.mock('dotenv');
jest.mock('fs');

const mockedDotenv = dotenv as jest.Mocked<typeof dotenv>;
const mockedFs = fs as jest.Mocked<typeof fs>;

describe('env-loader', () => {
  let envLoader: typeof import('../src/core/config/env-loader');
  
  beforeEach(() => {
    // Clear modules and mocks
    jest.clearAllMocks();
    jest.resetModules();
    
    // Reset environment variables
    delete process.env.NEXT_PUBLIC_VAPI_WEB_TOKEN;
    delete process.env.DATABASE_URL;
    
    // Import fresh instance after clearing modules
    envLoader = require('../src/core/config/env-loader');
  });

  describe('getProjectRoot', () => {
    it('should return a path that ends with the expected structure', () => {
      const root = envLoader.getProjectRoot();
      
      expect(typeof root).toBe('string');
      expect(root.length).toBeGreaterThan(0);
      expect(path.isAbsolute(root)).toBe(true);
    });

    it('should return a consistent path across multiple calls', () => {
      const root1 = envLoader.getProjectRoot();
      const root2 = envLoader.getProjectRoot();
      
      expect(root1).toBe(root2);
    });

    it('should return a path that resolves properly', () => {
      const root = envLoader.getProjectRoot();
      const resolved = path.resolve(root);
      
      expect(root).toBe(resolved);
    });
  });

  describe('getEnvPath', () => {
    it('should return a path to .env.local file', () => {
      const envPath = envLoader.getEnvPath();
      
      expect(envPath).toContain('.env.local');
      expect(path.isAbsolute(envPath)).toBe(true);
    });

    it('should return a path relative to project root', () => {
      const envPath = envLoader.getEnvPath();
      const projectRoot = envLoader.getProjectRoot();
      
      expect(envPath).toBe(path.resolve(projectRoot, '.env.local'));
    });

    it('should be consistent across multiple calls', () => {
      const envPath1 = envLoader.getEnvPath();
      const envPath2 = envLoader.getEnvPath();
      
      expect(envPath1).toBe(envPath2);
    });
  });
});
