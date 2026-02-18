import { sanitizeUrl, sanitizeForLogging, validateUrlSecurity, validateFormSecurity } from '../src/core/utils';


describe('Security Utilities', () => {
    describe('sanitizeUrl', () => {
        it('should remove sensitive parameters from URL', () => {
            const url = 'https://example.com/login?email=test@example.com&password=secret&redirect=/dashboard';
            const sanitized = sanitizeUrl(url);
            expect(sanitized).toBe('https://example.com/login?redirect=%2Fdashboard');
        });

        it('should handle URLs without sensitive parameters', () => {
            const url = 'https://example.com/dashboard?page=1&sort=name';
            const sanitized = sanitizeUrl(url);
            expect(sanitized).toBe(url);
        });

        it('should handle invalid URLs gracefully', () => {
            const url = 'not-a-valid-url';
            const sanitized = sanitizeUrl(url);
            expect(sanitized).toBe(url);
        });
    });

    describe('sanitizeForLogging', () => {
        it('should redact sensitive fields', () => {
            const obj = {
                email: 'test@example.com',
                password: 'secret123',
                name: 'John Doe',
                token: 'abc123'
            };
            const sanitized = sanitizeForLogging(obj);
            expect(sanitized).toEqual({
                email: '[REDACTED]',
                password: '[REDACTED]',
                name: 'John Doe',
                token: '[REDACTED]'
            });
        });

        it('should handle non-objects', () => {
            expect(sanitizeForLogging(null)).toBe(null);
            expect(sanitizeForLogging('string')).toBe('string');
            expect(sanitizeForLogging(123)).toBe(123);
        });
    });

    describe('validateUrlSecurity', () => {
        it('should return false for URLs with sensitive parameters', () => {
            expect(validateUrlSecurity('https://example.com?email=test&password=secret')).toBe(false);
            expect(validateUrlSecurity('https://example.com?token=abc123')).toBe(false);
        });

        it('should return true for URLs without sensitive parameters', () => {
            expect(validateUrlSecurity('https://example.com?page=1&sort=name')).toBe(true);
            expect(validateUrlSecurity('https://example.com')).toBe(true);
        });

        it('should handle invalid URLs', () => {
            expect(validateUrlSecurity('not-a-valid-url')).toBe(false);
        });
    });

    describe('validateFormSecurity', () => {
        it('should return false for FormData with sensitive fields', () => {
            const formData = new FormData();
            formData.append('email', 'test@example.com');
            formData.append('password', 'secret123');
            expect(validateFormSecurity(formData)).toBe(false);
        });

        it('should return true for FormData without sensitive fields', () => {
            const formData = new FormData();
            formData.append('name', 'John Doe');
            formData.append('age', '30');
            expect(validateFormSecurity(formData)).toBe(true);
        });
    });
}); 