/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        background: '#F6F8FB',
        navy: {
          50: '#F2F6FA',
          100: '#E2EAF3',
          200: '#C5D5E7',
          300: '#9DBADB',
          400: '#6C99CB',
          500: '#467AB9',
          600: '#32609B',
          700: '#254B7C',
          800: '#1C3D66',
          900: '#142B4A', // Core Brand Deep Navy
          950: '#0B1728',
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
        card: '0 1px 3px 0 rgba(20, 43, 74, 0.05), 0 1px 2px -1px rgba(20, 43, 74, 0.05)',
        'card-hover': '0 4px 6px -1px rgba(20, 43, 74, 0.08), 0 2px 4px -2px rgba(20, 43, 74, 0.08)',
        modal: '0 20px 25px -5px rgba(20, 43, 74, 0.15), 0 8px 10px -6px rgba(20, 43, 74, 0.1)',
      },
    },
  },
  plugins: [],
};
