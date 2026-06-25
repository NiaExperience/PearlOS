/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        serif: ['"Cormorant Garamond"', "serif"],
        sans: ['"DM Sans"', "sans-serif"],
        mono: ['"JetBrains Mono"', "monospace"],
      },
      colors: {
        pearl: {
          50: "#F0F6FA",
          100: "#D6E8F2",
          200: "#A8CCE0",
          300: "#6BA3C4",
          400: "#3A7BA8",
          500: "#1A4F72",
          600: "#143D5A",
          700: "#0E2B42",
          800: "#081A2A",
          900: "#040D15",
        },
        cream: "#F5F0EA",
        accent: "#7EC8E3",
        "accent-bright": "#A8E6F0",
        gold: "#C9A96E",
      },
    },
  },
  plugins: [],
};
