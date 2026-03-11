// theme.svelte.js - Theme state store (dark/light mode)

let theme = $state(loadTheme());

function loadTheme() {
  try {
    const saved = localStorage.getItem('palmux-theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* ignore */ }
  return 'dark';
}

export function getTheme() { return theme; }

export function setTheme(t) {
  theme = t;
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem('palmux-theme', t); } catch { /* ignore */ }
}

export function toggleTheme() {
  setTheme(theme === 'dark' ? 'light' : 'dark');
}

export function isDark() { return theme === 'dark'; }

// Apply theme on module load
document.documentElement.setAttribute('data-theme', getTheme());
