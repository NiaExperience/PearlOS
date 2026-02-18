import type { Config } from 'tailwindcss';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const config = {
  darkMode: ['class'],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  prefix: '',
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      fontFamily: {
        'koffins': ['Koffins', 'serif'],
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar-background))',
          foreground: 'hsl(var(--sidebar-foreground))',
          primary: 'hsl(var(--sidebar-primary))',
          'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
          accent: 'hsl(var(--sidebar-accent))',
          'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
          border: 'hsl(var(--sidebar-border))',
          ring: 'hsl(var(--sidebar-ring))',
        },
        nia: {
          dark: '#0a1b29',
          blue: '#0e2c44',
          accent: '#f97316',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        float: {
          '0%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        twinkle: {
          '0%': { opacity: '1' },
          '50%': { opacity: '0.5' },
        },
        breathe: {
          '0%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.05)' },
        },
        'rotate-slow': {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
        'pulse-slow': {
          '0%': { opacity: '1' },
          '50%': { opacity: '0.7' },
        },
        'shooting-star': {
          '0%': { transform: 'translateX(0) translateY(0)', opacity: '0' },
          '10%': { opacity: '1' },
          '100%': { transform: 'translateX(300px) translateY(200px)', opacity: '0' },
        },
        'bubble-float': {
          '0%': { transform: 'translateY(0px) translateX(0px) scale(1)' },
          '25%': { transform: 'translateY(-8px) translateX(3px) scale(1.02)' },
          '50%': { transform: 'translateY(-5px) translateX(-2px) scale(1)' },
          '75%': { transform: 'translateY(-12px) translateX(1px) scale(0.98)' },
          '100%': { transform: 'translateY(0px) translateX(0px) scale(1)' },
        },
        'bubble-drift': {
          '0%': { transform: 'translateX(0px) rotate(0deg)' },
          '33%': { transform: 'translateX(8px) rotate(1deg)' },
          '66%': { transform: 'translateX(-5px) rotate(-1deg)' },
          '100%': { transform: 'translateX(0px) rotate(0deg)' },
        },
        'avatar-popup': {
          '0%': { 
            transform: 'scale(0.3) translateY(0px)', 
            opacity: '0' 
          },
          '60%': { 
            transform: 'scale(1.1) translateY(-10px)', 
            opacity: '1' 
          },
          '100%': { 
            transform: 'scale(1) translateY(0px)', 
            opacity: '1' 
          },
        },
        'avatar-hide': {
          '0%': { 
            transform: 'scale(1) translateY(0px)', 
            opacity: '1' 
          },
          '40%': { 
            transform: 'scale(1.1) translateY(-10px)', 
            opacity: '1' 
          },
          '100%': { 
            transform: 'scale(0.3) translateY(0px)', 
            opacity: '0' 
          },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        float: 'float 6s ease-in-out infinite',
        twinkle: 'twinkle 4s ease-in-out infinite',
        'twinkle-delay': 'twinkle 4s ease-in-out 1s infinite',
        'twinkle-delay-2': 'twinkle 4s ease-in-out 2s infinite',
        breathe: 'breathe 8s ease-in-out infinite',
        'rotate-slow': 'rotate-slow 120s linear infinite',
        'pulse-slow': 'pulse-slow 4s ease-in-out infinite',
        'shooting-star': 'shooting-star 4s ease-out infinite',
        'bubble-float': 'bubble-float 6s ease-in-out infinite',
        'bubble-drift': 'bubble-drift 8s ease-in-out infinite',
        'avatar-popup': 'avatar-popup 1s cubic-bezier(0.68, -0.55, 0.265, 1.55)',
        'avatar-hide': 'avatar-hide 1s cubic-bezier(0.68, -0.55, 0.265, 1.55)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
} satisfies Config;

export default config;