import '@types/jest';

declare global {
  namespace jest {
    interface Matchers<R> {
      toBe(expected: any): R;
      toEqual(expected: any): R;
      toBeDefined(): R;
      toBeUndefined(): R;
      toBeNull(): R;
      toHaveBeenCalled(): R;
      toHaveBeenCalledWith(...args: any[]): R;
      toHaveLength(expected: number): R;
      toHaveProperty(key: string): R;
    }
  }
}

// Remove Chai types
declare module 'chai' {
  export = undefined;
} 