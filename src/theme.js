const storageKey = 'b03-theme';
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
const validTheme = value => value === 'light' || value === 'dark';
let preference = null;
try {
  const saved = window.localStorage.getItem(storageKey);
  if (validTheme(saved)) preference = saved;
} catch { /* Private browsing can make storage unavailable; play still works. */ }

export function currentTheme() {
  return preference || (systemTheme.matches ? 'dark' : 'light');
}

export function syncThemeControls() {
  const theme = currentTheme();
  document.querySelectorAll('.theme-switch button[data-theme]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.theme === theme));
  });
}

function applyTheme() {
  const theme = currentTheme();
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#292b2e' : '#e8eaeb');
  syncThemeControls();
}

export function selectTheme(theme) {
  if (!validTheme(theme)) return;
  preference = theme;
  try { window.localStorage.setItem(storageKey, theme); } catch { /* Keep the in-memory choice. */ }
  // Only paint changes: the map, focus, game state and measurement clock stay intact.
  applyTheme();
}

systemTheme.addEventListener('change', () => { if (!preference) applyTheme(); });
window.addEventListener('storage', event => {
  if (event.key !== storageKey && event.key !== null) return;
  preference = validTheme(event.newValue) ? event.newValue : null;
  applyTheme();
});
applyTheme();
