/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        background: '#F6F8FB',
        navy: {
          // Built on the BKR Infra logo navy (#2A3384)
          50: '#F4F5FB',
          100: '#E6E8F5',
          200: '#CDD1EC',
          300: '#A9AFDD',
          400: '#7D85C8',
          500: '#5A63B8',
          600: '#4750AA',
          700: '#3B4499',
          800: '#323B8E',
          850: '#2E3789',
          900: '#2A3384', // Logo navy
          950: '#181D52', // Deep navy (sidebar)
        },
        brand: {
          // BKR Infra logo red (#D9262E) — the accent colour
          50: '#FDF2F2',
          100: '#FCE4E5',
          200: '#F9CACC',
          300: '#F3A0A4',
          400: '#EA6A70',
          500: '#E0434A',
          600: '#D9262E', // Logo red
          700: '#B71E25',
          800: '#971D23',
          900: '#7E1D22',
          950: '#450A0D',
        },
        amber: {
          50: '#FFF9ED',
          100: '#FEF3DC',
          200: '#FDE4B5',
          300: '#FCD184',
          400: '#F8B744',
          500: '#F5A623', // Core Construction Amber
          600: '#D98B12',
          700: '#B46D0E',
          800: '#8F5413',
          900: '#754613',
        },
        slate: {
          850: '#151F30',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Oxygen',
          'Ubuntu',
          'Cantarell',
          'sans-serif',
        ],
      },
      boxShadow: {
        card: '0 1px 3px 0 rgba(24, 29, 82, 0.05), 0 1px 2px -1px rgba(24, 29, 82, 0.05)',
        'card-hover': '0 4px 6px -1px rgba(24, 29, 82, 0.08), 0 2px 4px -2px rgba(24, 29, 82, 0.08)',
        modal: '0 20px 25px -5px rgba(24, 29, 82, 0.15), 0 8px 10px -6px rgba(24, 29, 82, 0.1)',
      },
    },
  },
  plugins: [],
};
