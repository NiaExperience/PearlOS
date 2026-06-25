import baseConfig from '../jest.config.mjs';

export default {
  ...baseConfig,
  rootDir: '..',
  testMatch: [
    '<rootDir>/apps/interface/__tests__/files-view.test.tsx',
    '<rootDir>/apps/interface/__tests__/files.api.test.ts',
  ],
  globalSetup: '<rootDir>/tests/jest-noop-global-setup.js',
  globalTeardown: '<rootDir>/tests/jest-noop-global-teardown.js',
  collectCoverage: false,
  modulePathIgnorePatterns: [
    ...(baseConfig.modulePathIgnorePatterns || []),
    '<rootDir>/forensics/',
  ],
  transform: {
    '^.+\\.(ts|tsx)$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.json',
        useESM: false,
        babelConfig: false,
        diagnostics: {
          ignoreCodes: [1343],
        },
      },
    ],
  },
};
