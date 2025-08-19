debugger;
console.log('[sandbox] test start, parent:', window.parent);
try {
  console.log('[sandbox] document.domain:', document.domain);
} catch(e) { console.error('[sandbox] document.domain err', e); }
try {
  document.cookie = 'sandbox_test=1; SameSite=None; Secure'; // try to set a cookie
  console.log('[sandbox] set cookie OK');
} catch(e) {
  console.error('[sandbox] set cookie error', e);
}
try {
  const c = document.cookie;
  console.log('[sandbox] read cookie:', c);
} catch(e) {
  console.error('[sandbox] read cookie error', e);
}


window.addEventListener('message', (ev) => {
  try {
    console.log("[sandbox] incoming message:", ev.data, "origin:", ev.origin, "from parent?", ev.source === window.parent);
    const d = ev.data || {};

    // respond to ping with token
    if (d && d.type === 'sandbox-ping' && d.token) {
      try {
        window.parent.postMessage({ type: 'sandbox-pong', token: d.token, __fromSandbox: true }, '*');
        console.log("[sandbox] replied pong for token", d.token);
      } catch (e) {
        console.error("[sandbox] failed to post pong", e);
      }
      // ensure port handler is installed (idempotent)
      if (typeof installPortHandler === 'function' && !window.__portHandlerInstalled) {
        installPortHandler();
        window.__portHandlerInstalled = true;
      }
      return;
    }

    // optional legacy ready: if parent asked for 'sandbox-ready', reply
    if (d && d.type === 'sandbox-ready') {
      try {
        window.parent.postMessage({ __fromSandbox: true, type: 'sandbox-ready' }, '*');
        console.log("[sandbox] replied legacy-ready");
      } catch (e) { console.error(e); }
      return;
    }

  } catch (e) {
    console.error("[sandbox] message handler error", e);
  }
});

/* exported gapiLoaded */
/* exported gisLoaded */
/* exported handleAuthClick */
/* exported handleSignoutClick */
// Discovery doc URL for APIs used by the quickstart
const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/tasks/v1/rest';

// Authorization scopes required by the API; multiple scopes can be
// included, separated by spaces.
const SCOPES = 'https://www.googleapis.com/auth/tasks.readonly';

/**
 * Callback after api.js is loaded.
 */
function gapiLoaded() {
gapi.load('client', initializeGapiClient);
}

/**
 * Callback after the API client is loaded. Loads the
 * discovery doc to initialize the API.
 */
async function initializeGapiClient(user_api_key) {
await gapi.client.init({
    apiKey: user_api_key,
    discoveryDocs: [DISCOVERY_DOC],
});
return true;
// gapiInited = true;
// maybeEnableButtons();
}

/**
 * Callback after Google Identity Services are loaded.
 */
function gisLoaded(user_client_id) {
tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: user_client_id,
    scope: SCOPES,
    callback: '', // defined later
});
return tokenClient;
//gisInited = true;
//maybeEnableButtons();
}

/**
 *  Sign in the user upon button click.
 */
function handleAuthClick(tokenClient) {
tokenClient.callback = async (resp) => {
    if (resp.error !== undefined) {
    throw (resp);
    }
    // document.getElementById('signout_button').style.visibility = 'visible';
    // document.getElementById('authorize_button').innerText = 'Refresh';
    await fetchTaskLists();
};

if (gapi.client.getToken() === null) {
    // Prompt the user to select a Google Account and ask for consent to share their data
    // when establishing a new session.
    tokenClient.requestAccessToken({prompt: 'consent'});
} else {
    // Skip display of account chooser and consent dialog for an existing session.
    tokenClient.requestAccessToken({prompt: ''});
}
}

/**
 *  Sign out the user upon button click.
 */
function handleSignoutClick() {
const token = gapi.client.getToken();
if (token !== null) {
    google.accounts.oauth2.revoke(token.access_token);
    gapi.client.setToken('');
    // document.getElementById('content').innerText = '';
    // document.getElementById('authorize_button').innerText = 'Authorize';
    // document.getElementById('signout_button').style.visibility = 'hidden';
}

window.onerror = function(msg, src, line, col, err) {
  console.error("[sandbox] runtime error:", msg, { src, line, col, err });
  // also notify parent so offscreen can surface errors
  try {
    window.parent.postMessage({ __fromSandbox: true, type: 'sandbox-error', error: String(msg) }, '*');
  } catch (e) { /* ignore */ }
};

// handshake to parent/offscreen: tell parent we're ready
// try {
//   window.parent.postMessage({ __fromSandbox: true, type: 'sandbox-ready' }, '*');
//   console.log("[sandbox] posted handshake to parent:", window.parent);

// } catch (e) {
//   console.error("[sandbox] handshake postMessage failed:", e);
// }

// install your robust message listener (use the improved one you already have)
window.addEventListener('message', async (event) => {
  console.log("[sandbox] message event received", event.data, "ports:", event.ports && event.ports.length);
  const { data, ports } = event;
  const port = ports && ports[0];
  if (!port) {
    console.warn("[sandbox] no MessagePort transferred");
    return;
  }
  try { port.start && port.start(); } catch (e) {}
  // ... rest of your safePost/exec code (the hardened listener I gave earlier)
});

// window.addEventListener('message', async (event) => {
//   const { data, ports } = event;
//   const port = ports && ports[0];
//   if (!port) return;
//   console.log(data.cmd + " reached sandbox");

//   const fn = functionProvided[data.cmd];
//   try {
//     if (typeof fn === "function") {
//       const result = await fn(data.arg);
//       port.postMessage({success: true, result: result}, event.origin);
//     } else {
//       port.postMessage({ success: false, result: result }, event.origin);
//     }
//   } catch(err) {
//     port.postMessage({ success: false, error: err.message });
//   }
//   return true;
// });
}

const functionProvided = {gapiLoaded, gisLoaded, handleAuthClick, handleSignoutClick};


// installPortHandler must be defined later in the file (or inline here).
// It should install a message listener that grabs event.ports[0] and handles requests.
// sandbox.js — robust port handler
function installPortHandler() {
  // guard to avoid double install
  if (window.__portHandlerInstalled) return;
  window.__portHandlerInstalled = true;

  window.addEventListener('message', (event) => {
    try {
      // Log raw message and ports for debugging
      console.log('[sandbox] incoming message:', event.data, 'origin:', event.origin, 'portsLength:', (event.ports && event.ports.length));
      const { data, ports } = event;
      const port = ports && ports[0];

      if (!port) {
        console.warn('[sandbox] No MessagePort transferred with message — data:', data);
        return;
      }

      // Start port (safe to call even if already started)
      try { port.start && port.start(); } catch (e) { console.warn('[sandbox] port.start threw', e); }

      // Helper to safely post back on port
      const safePost = (msg) => {
        try {
          port.postMessage(msg);
        } catch (e) {
          console.error('[sandbox] port.postMessage failed', e, 'msg:', msg);
        }
      };

      // If the caller expects us to receive messages on the port, set onmessage handler
      port.onmessage = (pe) => {
        console.log('[sandbox] port.onmessage received (unlikely for one-shot):', pe.data);
      };
      port.onmessageerror = (err) => {
        console.warn('[sandbox] port.onmessageerror', err);
      };

      // Execute requested command and reply on the port
      (async () => {
        try {
          const cmd = data && data.cmd;
          if (!cmd) {
            safePost({ success: false, error: 'missing cmd' });
            try { port.close(); } catch (e) {}
            return;
          }

          const fn = (functionProvided && functionProvided[cmd]);
          if (typeof fn !== 'function') {
            safePost({ success: false, error: `Unknown command: ${String(cmd)}` });
            try { port.close(); } catch (e) {}
            return;
          }

          const args = Array.isArray(data.args) ? data.args : (data.arg === undefined ? [] : [data.arg]);
          console.log('[sandbox] calling', cmd, 'with', args);
          const result = await fn.apply(null, args);
          safePost({ success: true, result });
        } catch (err) {
          console.error('[sandbox] error executing fn', err);
          safePost({ success: false, error: err && err.message ? err.message : String(err) });
        } finally {
          try { port.close(); } catch (e) { /* ignore */ }
        }
      })();

    } catch (outerErr) {
      console.error('[sandbox] unexpected error in message handler', outerErr);
    }
  });
}


