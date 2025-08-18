async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (contexts.length === 0) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['DOM_PARSER'],
      justification: 'Hidden bridge between side panel and sandboxed iframe'
    });
    console.log("offscreen created")
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.target === 'offscreen') {
      await ensureOffscreen();
      chrome.runtime.sendMessage(
        { target: 'offscreen-internal', cmd: msg.cmd, data: msg.data },
        (reply) => sendResponse(reply)
      );
    }
  })();
  return true;
});
