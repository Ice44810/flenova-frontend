/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './*.html',
    './js/**/*.js'
  ],
  theme: {
    extend: {
      /* Laptop-first : lg (1024px) = référence principale ; réduire avec max-* ou grilles 1 col */
      screens: {
        xs: '480px',
        sm: '640px',
        md: '768px',
        lg: '1024px',
        xl: '1280px',
        '2xl': '1536px'
      },
      maxWidth: {
        public: '1140px',
        'public-wide': '1280px'
      }
    }
  },
  plugins: []
};
