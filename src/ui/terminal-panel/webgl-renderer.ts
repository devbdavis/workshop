import type { Terminal } from '@xterm/xterm';
import { WebglAddon } from '@xterm/addon-webgl';

/**
 * Move rendering to the GPU when possible. Must run after `term.open()`.
 * Any failure leaves xterm on its built-in DOM renderer: loadAddon throws
 * when WebGL2 context creation fails, and disposing the addon on context
 * loss (GPU reset, too many contexts) hands rendering back to the DOM
 * renderer instead of leaving the pane blank.
 */
export function loadWebglRenderer(term: Terminal): void {
  const addon = new WebglAddon();
  try {
    term.loadAddon(addon);
  } catch (err) {
    console.warn('[terminal] WebGL unavailable, using DOM renderer', err);
    addon.dispose();
    return;
  }
  addon.onContextLoss(() => {
    console.warn('[terminal] WebGL context lost, falling back to DOM renderer');
    addon.dispose();
  });
}
