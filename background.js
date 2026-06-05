// Service worker — bridges chrome.identity (only available in background) to content script.

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_TOKEN') {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError) {
        sendResponse({ error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ token });
      }
    });
    return true; // keep message channel open for async response
  }

  if (message.type === 'REMOVE_TOKEN') {
    // Call this after a 401 so Chrome fetches a fresh token next time.
    chrome.identity.removeCachedAuthToken({ token: message.token }, () => {
      sendResponse({ ok: true });
    });
    return true;
  }
});
