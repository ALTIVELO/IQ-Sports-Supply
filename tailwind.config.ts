import type { Config } from 'tailwindcss';

/* Brand identity carried over from the prototype: cool slate + cobalt, Archivo. */
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#16222E',
        cobalt: '#2242C8',
        parch: '#F2F4F6',
        line: '#DCE2E8',
        mute: '#5B6B79',
        'row-line': '#EAEEF2',
        danger: '#B3361F',
        success: '#2E6B45',
      },
      fontFamily: {
        sans: ['Archivo', 'system-ui', 'sans-serif'],
      },
      borderRadius: { card: '6px' },
    },
  },
  plugins: [],
} satisfies Config;
