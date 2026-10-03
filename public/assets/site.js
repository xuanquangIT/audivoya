// Progressive enhancement only; navigation and disclosure controls work without JS.
const currentYear = document.querySelector('[data-current-year]');
if (currentYear) currentYear.textContent = String(new Date().getFullYear());
