/* Apply the saved appearance before CSS paints; blocked storage falls back to light. */
(() => {
  'use strict';
  const key = 'spacephilic-theme';
  const valid = value => value === 'dark' ? 'dark' : 'light';
  let saved = 'light';
  try { saved = localStorage.getItem(key); } catch (_) { /* Storage is optional. */ }
  const apply = (value, persist = false) => {
    const theme = valid(value);
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    if (persist) { try { localStorage.setItem(key, theme); } catch (_) {} }
    window.dispatchEvent(new CustomEvent('workspace:theme', { detail: { theme } }));
    return theme;
  };
  apply(saved);
  window.WorkspaceTheme = { get: () => document.documentElement.dataset.theme, set: value => apply(value, true) };
  window.addEventListener('storage', event => { if (event.key === key) apply(event.newValue); });
})();
