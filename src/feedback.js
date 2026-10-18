const pulseTimers = new WeakMap();

export function pulseFeedback(element, className, duration = 220) {
  if (!element) return;
  const timers = pulseTimers.get(element) || new Map();
  clearTimeout(timers.get(className));
  element.classList.remove(className);
  // Restart a one-shot response without delaying or replaying the action.
  void element.offsetWidth;
  element.classList.add(className);
  timers.set(className, setTimeout(() => {
    element.classList.remove(className);
    timers.delete(className);
  }, duration));
  pulseTimers.set(element, timers);
}

/** Visual feedback only: native clicks and the game's confirmation rules remain authoritative. */
export function installControlFeedback(root) {
  let pressed = null;
  const receipts = new WeakMap();
  const control = target => {
    const element = target instanceof Element ? target.closest('button, summary') : null;
    return element && root.contains(element) && !element.matches(':disabled') ? element : null;
  };
  const release = () => {
    pressed?.element.classList.remove('is-pressed');
    pressed = null;
  };
  const selectorFor = element => {
    for (const key of ['theme', 'level', 'record', 'action']) {
      if (element.dataset[key] === undefined) continue;
      const kind = element.classList.contains('brand') ? 'button.brand' : 'button:not(.brand)';
      return `${kind}[data-${key}="${CSS.escape(element.dataset[key])}"]`;
    }
    if (element.matches('.settings > summary')) return '.settings > summary';
    if (element.matches('.help > summary')) return '.help > summary';
    return null;
  };

  root.addEventListener('pointerdown', event => {
    release();
    const element = control(event.target);
    if (!element || event.button !== 0 || event.isPrimary === false) return;
    pressed = { element, pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    element.classList.add('is-pressed');
  }, true);
  window.addEventListener('pointermove', event => {
    if (pressed?.pointerId !== event.pointerId) return;
    const bounds = pressed.element.getBoundingClientRect();
    if (Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) > 10
      || event.clientX < bounds.left || event.clientX > bounds.right
      || event.clientY < bounds.top || event.clientY > bounds.bottom) release();
  }, { passive: true });
  window.addEventListener('pointerup', event => {
    if (pressed?.pointerId === event.pointerId) release();
  }, true);
  window.addEventListener('pointercancel', release, true);
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape') { release(); return; }
    if (!['Enter', ' '].includes(event.key) || event.repeat) return;
    const element = control(event.target);
    if (!element) return;
    release();
    pressed = { element, key: event.key };
    element.classList.add('is-pressed');
  }, true);
  window.addEventListener('keyup', event => {
    if (pressed?.key === event.key) release();
  }, true);
  root.addEventListener('focusout', event => {
    if (pressed?.element === event.target) release();
  });
  window.addEventListener('blur', release);
  document.addEventListener('visibilitychange', () => { if (document.hidden) release(); });

  root.addEventListener('click', event => {
    const element = control(event.target);
    if (!element) return;
    receipts.set(event, { element, selector: selectorFor(element) });
  }, true);
  // Install after the application's click handler: capture remembers the old
  // control and bubbling finds its replacement after the synchronous render.
  root.addEventListener('click', event => {
    const receipt = receipts.get(event);
    if (!receipt) return;
    const { element, selector } = receipt;
    const current = element.isConnected ? element : selector ? root.querySelector(selector) : null;
    if (current && !current.matches(':disabled')) pulseFeedback(current, 'is-activated');
  });
}
