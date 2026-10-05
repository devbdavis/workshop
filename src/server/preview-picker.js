/**
 * Design Mode picker — injected into the previewed app's HTML by preview-proxy.ts.
 * Plain browser JS (no build step): runs inside the preview iframe, lets the user
 * hover/click a DOM element, and posts the pick back to the parent (Workshop UI).
 */
(function () {
  if (window.__workshopPickerLoaded) return;
  window.__workshopPickerLoaded = true;
  // Only active inside Workshop's iframe — never when loaded as a top-level page.
  if (window.top === window) return;

  var STYLE_KEYS = [
    'color', 'background-color', 'font-family', 'font-size', 'font-weight',
    'line-height', 'letter-spacing', 'text-align', 'display', 'position',
    'width', 'height', 'margin', 'padding', 'border', 'border-radius',
    'box-shadow', 'gap', 'flex-direction', 'justify-content', 'align-items',
    'opacity', 'z-index',
  ];

  var pickModeOn = false;
  var parentOrigin = null;
  var overlay = null;
  var label = null;

  function cssEscape(s) {
    if (window.CSS && CSS.escape) return CSS.escape(s);
    return s.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  /** Unique CSS selector for `el`: prefer a unique #id, else a direct-child nth-of-type chain. */
  function uniqueSelector(el) {
    if (el.id) {
      try {
        var idSel = '#' + cssEscape(el.id);
        if (document.querySelectorAll(idSel).length === 1) return idSel;
      } catch (e) { /* invalid id for CSS.escape */ }
    }

    var parts = [];
    var node = el;
    while (node && node.nodeType === 1 && node !== document.body && node !== document.documentElement) {
      if (node.id) {
        try {
          var idSel2 = '#' + cssEscape(node.id);
          if (document.querySelectorAll(idSel2).length === 1) {
            parts.unshift(idSel2);
            node = null;
            break;
          }
        } catch (e) { /* invalid id for CSS.escape */ }
      }
      var tag = node.tagName.toLowerCase();
      var parent = node.parentElement;
      var index = 1;
      if (parent) {
        var siblings = Array.prototype.filter.call(parent.children, function (c) { return c.tagName === node.tagName; });
        index = siblings.indexOf(node) + 1;
      }
      parts.unshift(tag + ':nth-of-type(' + index + ')');
      node = parent;
    }

    var selector = parts.join(' > ');
    try {
      if (document.querySelector(selector) === el) return selector;
    } catch (e) { /* malformed selector, fall through and return best-effort */ }
    return selector;
  }

  function truncate(s, max) {
    if (s.length <= max) return s;
    return s.slice(0, max) + '…[truncated]';
  }

  function getText(el) {
    return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  }

  function getStyles(el) {
    var cs = getComputedStyle(el);
    var out = {};
    STYLE_KEYS.forEach(function (k) { out[k] = cs.getPropertyValue(k); });
    return out;
  }

  /** React <19 dev builds attach the fiber under a `__reactFiber$<id>` own key. */
  function getReactSource(el) {
    var key = Object.keys(el).find(function (k) { return k.indexOf('__reactFiber$') === 0; });
    if (!key) return null;
    var fiber = el[key];
    var depth = 0;
    while (fiber && depth < 10) {
      if (fiber._debugSource) {
        var s = fiber._debugSource;
        return s.fileName + ':' + s.lineNumber + ':' + s.columnNumber;
      }
      fiber = fiber.return;
      depth++;
    }
    return null;
  }

  function getDataSource(el) {
    var node = el;
    while (node && node.nodeType === 1) {
      var v = node.getAttribute('data-source') || node.getAttribute('data-inspector-relative-path');
      if (v) return v;
      node = node.parentElement;
    }
    return null;
  }

  function getSource(el) {
    return getReactSource(el) || getDataSource(el) || null;
  }

  function buildPick(el) {
    var r = el.getBoundingClientRect();
    var parent = el.parentElement;
    return {
      selector: uniqueSelector(el),
      url: location.pathname + location.search,
      tag: el.tagName.toLowerCase(),
      text: getText(el),
      outerHTML: truncate(el.outerHTML, 4000),
      parentHTML: parent ? truncate(parent.outerHTML, 1500) : '',
      styles: getStyles(el),
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      source: getSource(el),
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  }

  function ensureOverlay() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = '2147483647';
    overlay.style.border = '2px solid #3b82f6';
    overlay.style.background = 'rgba(59, 130, 246, 0.1)';
    overlay.style.boxSizing = 'border-box';
    label = document.createElement('div');
    label.style.position = 'absolute';
    label.style.top = '-20px';
    label.style.left = '0';
    label.style.background = '#3b82f6';
    label.style.color = '#fff';
    label.style.font = '11px monospace';
    label.style.padding = '1px 4px';
    label.style.whiteSpace = 'nowrap';
    overlay.appendChild(label);
    document.body.appendChild(overlay);
  }

  function removeOverlay() {
    if (overlay) overlay.remove();
    overlay = null;
    label = null;
  }

  function updateOverlay(el) {
    ensureOverlay();
    var r = el.getBoundingClientRect();
    overlay.style.left = r.left + 'px';
    overlay.style.top = r.top + 'px';
    overlay.style.width = r.width + 'px';
    overlay.style.height = r.height + 'px';
    label.textContent = el.tagName.toLowerCase() + ' ' + uniqueSelector(el);
  }

  window.addEventListener('message', function (e) {
    if (e.source !== window.parent) return;
    var data = e.data;
    if (!data || data.type !== 'workshop:pick-mode') return;
    parentOrigin = e.origin;
    pickModeOn = !!data.on;
    if (!pickModeOn) removeOverlay();
  });

  document.addEventListener('mousemove', function (e) {
    if (!pickModeOn) return;
    var el = e.target;
    if (!el || el === overlay) return;
    updateOverlay(el);
  }, true);

  function swallow(e) {
    if (!pickModeOn) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }
  ['mousedown', 'mouseup', 'pointerdown'].forEach(function (type) {
    document.addEventListener(type, swallow, true);
  });

  document.addEventListener('click', function (e) {
    if (!pickModeOn) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (!parentOrigin) return;
    window.parent.postMessage({ type: 'workshop:pick', pick: buildPick(e.target) }, parentOrigin);
  }, true);

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !pickModeOn) return;
    pickModeOn = false;
    removeOverlay();
    if (parentOrigin) {
      window.parent.postMessage({ type: 'workshop:pick-mode', on: false }, parentOrigin);
    }
  });
})();
