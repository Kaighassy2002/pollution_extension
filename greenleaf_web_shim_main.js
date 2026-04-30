/**
 * Firefox MAIN-world bridge shim for GreenLeaf web app pages.
 * Declared directly in manifest content_scripts with world: "MAIN" so it runs
 * at document_start and avoids async injection race conditions.
 */
(function installGreenleafMainShim() {
  const BRIDGE = 'GREENLEAF_EXT_BRIDGE_v1';
  const MARK = '__greenleafFfExtShim';

  try {
    if (globalThis[MARK]) return;
    globalThis[MARK] = true;
  } catch (_) {
    // no-op
  }

  if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
    return;
  }

  let mid = 0;
  const pending = Object.create(null);

  window.addEventListener('message', (ev) => {
    if (!ev || ev.source !== window || !ev.data || !ev.data[BRIDGE] || ev.data.type !== 'sendMessageResponse') {
      return;
    }
    const cb = pending[ev.data.id];
    delete pending[ev.data.id];
    if (typeof cb === 'function') cb(ev.data.response);
  });

  function parseArgs(a, b, c, d) {
    if (typeof a === 'object' && a !== null && !Array.isArray(a)) {
      if (typeof b === 'function') return { message: a, cb: b };
      return { message: a, cb: null };
    }
    if (typeof a === 'string' && typeof b === 'object' && b !== null) {
      // (extensionId, message[, options], callback?) form
      if (typeof c === 'function') return { message: b, cb: c };
      if (typeof d === 'function') return { message: b, cb: d };
      return { message: b, cb: null };
    }
    return null;
  }

  const extIdFromUrl = new URLSearchParams(location.search).get('ext_id');
  globalThis.chrome = globalThis.chrome || {};
  globalThis.chrome.runtime = globalThis.chrome.runtime || {};
  globalThis.chrome.runtime.id = extIdFromUrl || globalThis.chrome.runtime.id || 'greenleaf-firefox-bridge';
  globalThis.chrome.runtime.sendMessage = function(a, b, c, d) {
    const parsed = parseArgs(a, b, c, d);
    if (!parsed || !parsed.message) {
      if (typeof Promise !== 'undefined') {
        return Promise.resolve({ success: false, error: 'Invalid sendMessage arguments' });
      }
      return;
    }

    const id = ++mid;
    if (parsed.cb) {
      pending[id] = parsed.cb;
      window.postMessage({ [BRIDGE]: true, type: 'sendMessage', id, message: parsed.message }, '*');
      return;
    }

    if (typeof Promise !== 'undefined') {
      return new Promise((resolve) => {
        pending[id] = resolve;
        window.postMessage({ [BRIDGE]: true, type: 'sendMessage', id, message: parsed.message }, '*');
      });
    }

    window.postMessage({ [BRIDGE]: true, type: 'sendMessage', id, message: parsed.message }, '*');
  };
})();
