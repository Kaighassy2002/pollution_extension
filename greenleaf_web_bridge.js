/**
 * Isolated-world bridge for the GreenLeaf web app (Firefox).
 * Requests background MAIN-world shim injection, then relays EXTENSION_TOKEN
 * messages from page context to the extension background.
 */
const GREENLEAF_EXT_BRIDGE = 'GREENLEAF_EXT_BRIDGE_v1';

function requestMainWorldShim() {
  chrome.runtime.sendMessage(
    { type: 'GREENLEAF_PREPARE_WEB_SHIM' },
    (res) => {
      // Best-effort only: popup flow polls for connection status anyway.
      // If the first attempt races with SW startup, retry once shortly after.
      if (chrome.runtime.lastError || !res || res.success === false) {
        setTimeout(() => {
          chrome.runtime.sendMessage({ type: 'GREENLEAF_PREPARE_WEB_SHIM' }, () => {});
        }, 150);
      }
    }
  );
}

requestMainWorldShim();

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
