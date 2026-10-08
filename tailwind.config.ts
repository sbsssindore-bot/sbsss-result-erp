import type { Config } from 'tailwindcss';
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: { extend: { colors: { ink: '#17233B', ink2: '#22314F', maroon: '#7A1F2B', paper: '#F2F4F8', line: '#D8DEE8' } } },
  plugins: [],
};
export default config;
