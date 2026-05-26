// Renderer-side overlay shown during a server-upgrade reconnect. Runs
// inside the in-instance web UI (which already has `window.codeplaneDesktop`
// via the shared preload) so we don't have to thread a separate IPC channel
// or modify the web bundle. Lives only as long as it takes for the main
// process to reload the window with the matching new UI bundle — at which
// point the page is replaced wholesale and the overlay vanishes naturally.

const RECONNECT_OVERLAY_SCRIPT = String.raw`
(() => {
  const ID = '__codeplane_reconnect_overlay__';
  if (document.getElementById(ID)) return;
  const api = (window).codeplaneDesktop?.instances;
  if (!api?.onOpenProgress) return;

  const root = document.createElement('div');
  root.id = ID;
  root.style.cssText = [
    'position:fixed', 'inset:0',
    'z-index:2147483647',
    'background:var(--background-base, #0e0e0e)',
    'display:flex', 'align-items:center', 'justify-content:center',
    'font-family:var(--font-family-sans, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif)',
    'font-size:13px',
    'color:var(--text-base, #f5f5f5)',
    'opacity:0',
    'transition:opacity 180ms ease-out',
  ].join(';');

  const card = document.createElement('div');
  card.style.cssText = [
    'box-sizing:border-box',
    'width:min(360px, calc(100vw - 64px))',
    'padding:0',
    'background:transparent',
    'border:0',
    'box-shadow:none',
    'display:flex', 'flex-direction:column', 'gap:14px',
  ].join(';');

  const title = document.createElement('div');
  title.textContent = 'Server upgraded';
  title.style.cssText = 'font-size:14px;font-weight:600;color:var(--text-base, #f5f5f5);text-align:center';

  const message = document.createElement('div');
  message.textContent = 'Downloading matching client UI…';
  message.style.cssText = 'font-size:13px;line-height:1.45;color:var(--text-weak, #a1a1aa);text-align:center';

  const meta = document.createElement('div');
  meta.style.cssText = 'font-size:11px;color:var(--text-weaker, #71717a);font-variant-numeric:tabular-nums;display:flex;justify-content:space-between;gap:12px';
  const phaseLabel = document.createElement('span');
  const versionLabel = document.createElement('span');
  meta.appendChild(phaseLabel);
  meta.appendChild(versionLabel);

  const track = document.createElement('div');
  track.style.cssText = 'box-sizing:border-box;height:8px;background:var(--surface-base, #27272a);border:1px solid var(--border-weak-base, #3f3f46);border-radius:999px;overflow:hidden;position:relative';
  const fill = document.createElement('div');
  fill.style.cssText = 'height:100%;width:4%;background:var(--border-active, #60a5fa);border-radius:inherit;transition:width 200ms ease';
  track.appendChild(fill);

  card.append(title, message, track, meta);
  root.append(card);
  document.body.append(root);
  // Two-frame fade so the browser commits the initial opacity:0 layout
  // before the transition kicks in — otherwise it pops without animating.
  requestAnimationFrame(() => requestAnimationFrame(() => { root.style.opacity = '1'; }));

  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    root.style.opacity = '0';
    setTimeout(() => { root.remove(); }, 220);
    if (typeof unsubscribe === 'function') unsubscribe();
  };

  const unsubscribe = api.onOpenProgress((info) => {
    if (!info || typeof info !== 'object') return;
    const percent = Math.max(4, Math.min(100, Number(info.percent) || 0));
    fill.style.width = percent + '%';
    if (info.message) message.textContent = String(info.message);
    if (info.phase) phaseLabel.textContent = String(info.phase);
    if (info.version) versionLabel.textContent = 'v' + String(info.version);
    if (info.phase === 'done' || info.phase === 'error') {
      // Done: the main process is about to reload the window into the new
      // UI bundle, which replaces this DOM anyway — but fade out first so
      // there's no flash if the load is fast.
      remove();
    }
  });
})();
`

export const reconnectOverlayScript = RECONNECT_OVERLAY_SCRIPT
