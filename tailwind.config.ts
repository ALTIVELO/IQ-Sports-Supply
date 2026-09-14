import type { Config } from 'tailwindcss';

/**
 * Brand palette, taken from the IQ Sports Supply logo.
 *
 * `flame` is the accent from the mark. It measures 3.36:1 against white, which
 * fails WCAG AA for normal text — as text on white AND as a fill behind white
 * text — so it is used for marks, active indicators, rules and focus, never to
 * carry small text. `flameText` is the darkened version (5.54:1) for links and
 * labels on a light ground; `ink` carries the primary buttons at 18.19:1.
 */
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#121619',
        'ink-soft': '#1C2228',
        'ink-line': '#2A3138',
        flame: '#FF4A1A',
        'flame-text': '#C2340C',
        'flame-tint': '#FFF1EC',
        parch: '#F4F5F7',
        line: '#E1E4E8',
        mute: '#5A6470',
        'row-line': '#EDEFF2',
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
