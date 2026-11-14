/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  // El mismo alias que tsconfig.json
  moduleNameMapper: {
    '^@/assets/(.*)$': '<rootDir>/assets/$1',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testMatch: ['<rootDir>/src/**/*.test.ts?(x)'],
};
