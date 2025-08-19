// offscreen.js - improved ensureSandbox()
let sandboxFrame = document.getElementById('sandbox-iframe');
let sandboxReady = false;
const pendingMsgs = [];
const openPorts = new Set();

function _createIframeIfNeeded() {
  if (!sandboxFrame) {
    const existing = document.getElementById('sandbox-iframe');
    if (existing) {
      sandboxFrame = existing;
    } else {
      sandboxFrame = document.createElement('iframe');
      sandboxFrame.id = 'sandbox-iframe';
      // keep originless if you prefer (we accept origin:null), but allow-scripts so sandbox runs
      sandboxFrame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
      sandboxFrame.src = chrome.runtime.getURL('sandbox.html');
      sandboxFrame.style.display = 'none';
      document.body.appendChild(sandboxFrame);
    }
  }
}

function randomToken(len = 8) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(n => n.toString(16).padStart(2, '0')).join('');
}

function ensureSandbox(timeoutMs = 8000) {
  if (sandboxReady) return Promise.resolve();

  _createIframeIfNeeded();
  console.log('[offscreen] iframe attrs:', sandboxFrame.id, sandboxFrame.src, sandboxFrame.getAttribute('sandbox'));


  return new Promise((resolve, reject) => {
    const token = randomToken(8);
    let settled = false;
    const start = Date.now();
    let pingInterval = null;
    let timeoutTimer = null;

    function cleanup() {
      window.removeEventListener('message', onMessage);
      if (pingInterval) clearInterval(pingInterval);
      if (timeoutTimer) clearTimeout(timeoutTimer);
    }

    function succeed() {
      if (settled) return;
      settled = true;
      cleanup();
      sandboxReady = true;
      console.log("[offscreen] sandbox ready (handshake ok)");
      resolve();
      // flush queued messages
      while (pendingMsgs.length) {
        const { payload, transfer, responder } = pendingMsgs.shift();
        _postToSandbox(payload, transfer, responder);
      }
    }

    function fail(err) {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err || new Error('sandbox handshake timeout'));
    }

    function onMessage(ev) {
      try {
        // logging every raw message helps debugging
        console.log("[offscreen] raw message seen:", ev.data, "origin:", ev.origin, "source===iframe?", ev.source === (sandboxFrame && sandboxFrame.contentWindow));

        const d = ev.data || {};
        if (d && d.type === 'sandbox-pong' && d.token === token && d.__fromSandbox === true) {
          console.log("[offscreen] got matching pong token:", d.token);
          succeed();
          return;
        }
        // legacy fallback: sandbox may post a simple ready flag
        if (d && d.__fromSandbox === true && d.type === 'sandbox-ready') {
          console.log("[offscreen] got legacy sandbox-ready");
          succeed();
          return;
        }
      } catch (e) {
        console.warn("[offscreen] onMessage error", e);
      }
    }

    window.addEventListener('message', onMessage);

    // ensure we wait for iframe load before we start aggressive pinging
    function startPingingNow() {
      // send one immediately and then repeat
      function sendPing() {
        try {
          console.log("[offscreen] sending sandbox-ping token:", token, "to contentWindow:", !!(sandboxFrame && sandboxFrame.contentWindow));
          sandboxFrame.contentWindow.postMessage({ type: 'sandbox-ping', token }, '*');
        } catch (e) {
          console.warn("[offscreen] ping postMessage threw", e);
        }
      }

      sendPing();
      pingInterval = setInterval(() => {
        // stop pinging if already timed out
        if (Date.now() - start > timeoutMs) return;
        sendPing();
      }, 300);

      timeoutTimer = setTimeout(() => {
        fail(new Error('sandbox handshake timeout'));
      }, timeoutMs);
    }

    // If iframe already loaded, start pinging. Otherwise wait for onload.
    try {
      const doc = sandboxFrame.contentDocument;
      const loaded = sandboxFrame.contentWindow && sandboxFrame.contentDocument && sandboxFrame.contentDocument.readyState === 'complete';
      if (sandboxFrame && sandboxFrame.contentWindow && sandboxFrame.contentDocument && (sandboxFrame.contentDocument.readyState === 'complete' || sandboxFrame.contentDocument.readyState === 'interactive')) {
        console.log("[offscreen] iframe already loaded, starting ping");
        startPingingNow();
      } else {
        // attach load; some environments may not fire load for about:blank etc, but for packaged sandbox.html it should
        sandboxFrame.addEventListener('load', function onLoad() {
          console.log("[offscreen] iframe load event fired");
          sandboxFrame.removeEventListener('load', onLoad);
          startPingingNow();
        });
        // As a belt-and-suspenders fallback, also start pinging after a short delay in case load doesn't fire
        setTimeout(() => {
          if (!settled && !pingInterval) {
            console.log("[offscreen] load delayed, starting ping after short delay");
            startPingingNow();
          }
        }, 400);
      }
    } catch (e) {
      // If simply reading contentDocument throws due to cross-origin, don't crash — start pinging anyway
      console.warn("[offscreen] error checking iframe.readyState (continuing):", e);
      startPingingNow();
    }
  });
}

// small helper used later
function _postToSandbox(payload, transferList, responder) {
  if (!sandboxFrame || !sandboxFrame.contentWindow) {
    responder && responder({ success:false, error:'no-sandbox-window' });
    return;
  }
  try {
    sandboxFrame.contentWindow.postMessage(payload, '*', transferList || []);
  } catch (e) {
    responder && responder({ success:false, error: e && e.message ? e.message : String(e) });
  }
}

console.log('[offscreen] iframe attrs:', sandboxFrame.id, sandboxFrame.src, sandboxFrame.getAttribute('sandbox'));

// Public relay entry used in your chrome.runtime.onMessage
function relayToSandbox(msg, sendResponse) {
  // Make sure sandbox exists & is ready before sending
  ensureSandbox().then(() => {
    const channel = new MessageChannel();
    openPorts.add(channel.port1);
    const timeout = setTimeout(() => {
      try { channel.port1.close(); } catch (e) {}
      openPorts.delete(channel.port1);
      sendResponse({ success:false, error: 'timeout' });
    }, 8000);

    channel.port1.onmessage = (e) => {
      clearTimeout(timeout);
      openPorts.delete(channel.port1);
      sendResponse(e.data);
      try { channel.port1.close(); } catch (e) {}
    };

    // Transfer port2 to sandbox
    _postToSandbox({ cmd: msg.cmd, arg: msg.arg }, [channel.port2]);
  }).catch((err) => {
    console.error("ensureSandbox failed:", err);
    sendResponse({ success:false, error: err && err.message ? err.message : String(err) });
  });
}

// --- Add this helper near the top of offscreen.js ---
async function callSandbox(cmd, arg, timeoutMs = 8000) {
  // ensure the sandbox handshake completes before we try to transfer a port
  await ensureSandbox();

  return new Promise((resolve, reject) => {
    const mc = new MessageChannel();
    const { port1, port2 } = mc;

    // Track open ports if you already use openPorts elsewhere
    try { openPorts.add(port1); } catch (e) {}

    let fired = false;
    const cleanup = () => {
      try { port1.onmessage = null; } catch (e) {}
      try { port1.onmessageerror = null; } catch (e) {}
      try { port1.close(); } catch (e) {}
      try { openPorts.delete(port1); } catch (e) {}
    };

    const timer = setTimeout(() => {
      if (fired) return;
      fired = true;
      cleanup();
      reject(new Error('sandbox response timeout'));
    }, timeoutMs);

    port1.onmessage = (ev) => {
      if (fired) return;
      fired = true;
      clearTimeout(timer);
      const data = ev.data;
      cleanup();
      if (data && data.success) resolve(data.result);
      else reject(new Error(data && data.error ? data.error : 'Unknown sandbox error'));
    };

    port1.onmessageerror = (err) => {
      if (fired) return;
      fired = true;
      clearTimeout(timer);
      cleanup();
      reject(new Error('port messageerror: ' + String(err)));
    };

    // Post to sandbox and transfer port2
    try {
      const payload = { cmd, arg };
      sandboxFrame.contentWindow.postMessage(payload, '*', [port2]);
      console.log("[offscreen] sent message to sandbox:", payload);
    } catch (err) {
      if (fired) return;
      fired = true;
      clearTimeout(timer);
      cleanup();
      reject(err);
    }
  });
}

// --- Replace your current chrome.runtime.onMessage listener body with this ---
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target === 'offscreen-internal') {
    console.log(`${msg.cmd} reached offscreen`);

    // Use callSandbox to send and await reply; keep channel open by returning true
    callSandbox(msg.cmd, msg.arg).then(
      (result) => {
        // Caller expects the shape you used previously { success: true, result } or similar.
        // We mirror your previous behavior: send the data object the sandbox would normally send.
        sendResponse({ success: true, result });
      },
      (err) => {
        console.error('[offscreen] callSandbox error:', err && err.message ? err.message : err);
        sendResponse({ success: false, error: err && err.message ? err.message : String(err) });
      }
    ).catch((err) => {
      // should not happen, but safe fallback
      console.error('[offscreen] unexpected error:', err);
      sendResponse({ success: false, error: String(err) });
    });

    // Indicate async response
    return true;
  }
});

