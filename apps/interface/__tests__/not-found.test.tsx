import { redirect } from 'next/navigation';
import NotFound from '../src/app/not-found';

// Mock next/navigation
jest.mock('next/navigation', () => ({
  redirect: jest.fn(),
}));

describe('NotFound Page', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should render Not Found UI when PEARLOS_ONLY is not enabled', () => {
    process.env.PEARLOS_ONLY = 'false';
    
    const result = NotFound();
    
    expect(redirect).not.toHaveBeenCalled();
    expect(result).toBeDefined();
    // If we were using testing-library we could check content, but checking it returns JSX is enough to prove it didn't redirect.
  });

  it('should redirect to root when PEARLOS_ONLY is enabled', () => {
    process.env.PEARLOS_ONLY = 'true';
    
    // NotFound is a component. When redirect() is called, it usually throws.
    // But since we mocked it to just jest.fn(), it won't throw unless we make it throw.
    // If it doesn't throw, the function might continue or return undefined depending on implementation.
    // In our implementation we will add: if (pearlosOnly) redirect('/'); return ...
    // So it will return the result of redirect (which is type never/void) or throw.
    
    try {
      NotFound();
    } catch (e) {
      // ignore redirect error if mock throws
    }
    
    expect(redirect).toHaveBeenCalledWith('/');
  });
});
