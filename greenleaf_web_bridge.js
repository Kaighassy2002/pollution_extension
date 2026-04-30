/**
 * Isolated-world bridge for the GreenLeaf web app (Firefox).
 * Injects a main-world shim via the background script so pages can call
 * chrome.runtime.sendMessage like Chromium's externally_connectable flow.
 */
const GREENLEAF_EXT_BRIDGE = 'GREENLEAF_EXT_BRIDGE_v1';

chrome.runtime.sendMessage({ type: 'GREENLEAF_PREPARE_WEB_SHIM' }, () => {});

window.addEventListener('message', (event) => {
  if (event.source !== window || !event.data || !event.data[GREENLEAF_EXT_BRIDGE]) return;
  if (event.data.type !== 'sendMessage') return;

  const { id, message: inner } = event.data;

  chrome.runtime.sendMessage(
    { type: 'RELAY_WEB_EXTENSION_TOKEN', payload: inner },
    (response) => {
      if (chrome.runtime.lastError) {
        window.postMessage(
          {
            [GREENLEAF_EXT_BRIDGE]: true,
            type: 'sendMessageResponse',
            id,
            response: { success: false, error: chrome.runtime.lastError.message },
          },
          '*'
        );
        return;
      }
      window.postMessage(
        {
          [GREENLEAF_EXT_BRIDGE]: true,
          type: 'sendMessageResponse',
          id,
          response: response || { success: false, error: 'No response from extension' },
        },
        '*'
      );
    }
  );
});
