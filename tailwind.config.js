/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './*.html',
    './js/**/*.js'
  ],
  theme: {
    extend: {
      /* lg (1024px) = sidebar fixe ; < lg = tiroir tactile (téléphone + tablette) */
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
