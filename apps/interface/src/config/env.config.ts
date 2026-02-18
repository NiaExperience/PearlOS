// Client-side environment configuration
// Note: Only NEXT_PUBLIC_ environment variables are available on the client


export const envConfig = {
  database: {
    url: process.env.DATABASE_URL,
  },
  twilio: {
    accountSid: process.env.NEXT_PUBLIC_TWILIO_ACCOUNT_SID,
    authToken: process.env.NEXT_PUBLIC_TWILIO_AUTH_TOKEN,
  },
  // Test mode configuration
  test: {
    autoLogin: process.env.NODE_ENV === 'test' || process.env.CYPRESS === 'true',
    anonymousUser: process.env.NEXT_PUBLIC_TEST_ANONYMOUS_USER === 'true',
  },
};
