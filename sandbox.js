debugger;
console.log("[sandbox] script loaded, parent is:", window.parent);
// sandbox.js
window.parent.postMessage({ __fromSandbox: true, type: 'sandbox-ready' }, '*');
console.log("sandbox am here (handshake sent)");

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

const functionProvided = {gapiLoaded, gisLoaded, handleAuthClick, handleSignoutClick};

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
