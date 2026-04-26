/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: { DEFAULT: '#0b0b0e', elev: '#15151a', surface: '#1d1d24' },
        border: { DEFAULT: '#2a2a32', strong: '#3a3a44' },
        text: { DEFAULT: '#e6e6ec', muted: '#8a8a96', subtle: '#5b5b66' },
        accent: { DEFAULT: '#7c5cff', hover: '#8e72ff', soft: '#2a2150' },
        success: '#3fb27f',
        warn: '#e2b73c',
        danger: '#e25b5b',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};
