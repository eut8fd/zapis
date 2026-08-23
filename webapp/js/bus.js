import { haptic } from './tg.js';
import { reportError } from './store.js';

const A = {};
export function on(name, fn) { A[name] = fn; }
export function has(name) { return !!A[name]; }
export function fire(name, ds = {}, el = null, ev = null) {
  const fn = A[name];
  if (!fn) { console.warn('no action:', name); return; }
  try { return fn(ds, el, ev); }
  catch (e) {
    console.error('action ' + name, e);
    try { reportError('Действие «' + name + '»: ' + e.message, { stack: e.stack || '', where: name }); } catch (x) { }
  }
}

let bound = false;
export function bindDelegation() {
  if (bound) return; bound = true;
  document.addEventListener('click', ev => {
    const el = ev.target.closest('[data-a]');
    if (!el) return;
    ev.preventDefault();
    if (!el.dataset.noHaptic) haptic(el.dataset.haptic || 'light');
    fire(el.dataset.a, el.dataset, el, ev);
  });
  document.addEventListener('keydown', ev => {
    if (ev.key === 'Enter' && ev.target.matches('input[data-enter]')) {
      const el = ev.target;
      fire(el.dataset.enter, el.dataset, el, ev);
    }
  });
}
