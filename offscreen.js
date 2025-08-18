function onHandshake(ev) {
  const d = ev.data || {};
  if (d.__fromSandbox === true && d.type === "sandbox-ready") {
    window.removeEventListener("message", onHandshake);
    clearTimeout(to);
    sandboxReady = true;
    resolve();
    console.log("offscreen got the sandbox handshake")
    // flush queued messages
    while (pendingMsgs.length) {
      const { payload, ports, responder } = pendingMsgs.shift();
      _postToSandbox(payload, ports, responder);
    }
  }
}

// let sandboxFrame;
// const openPorts = new Set();
// // create sandbox once
// function ensureSandbox() {
//   if (sandboxFrame) return;
//   sandboxFrame = document.createElement('iframe');
//   // IMPORTANT: load the extension's declared sandbox page
//   sandboxFrame.src = chrome.runtime.getURL('sandbox.html');
//   sandboxFrame.setAttribute('sandbox', 'allow-scripts allow-forms allow-popups allow-modals');
//   sandboxFrame.style.display = 'none';
//   document.body.appendChild(sandboxFrame);
//   console.log("sandbox loaded");
// }

// document.addEventListener("DOMContentLoaded", ensureSandbox());

// window.onerror = (a, b, c, d, e) => {
//   console.log(`message: ${a}`);
//   console.log(`source: ${b}`);
//   console.log(`lineno: ${c}`);
//   console.log(`colno: ${d}`);
//   console.log(`error: ${e}`);

//   return true;
// };


// // Receive messages from background and forward to sandbox
// chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
//   if (msg?.target === 'offscreen-internal') {
//     ensureSandbox(); // Make sure sandbox iframe exists
//     console.log(`${msg.cmd} reached offscreen`);

//     // Create a MessageChannel for two-way communication
//     const channel = new MessageChannel();
//     openPorts.add(channel.port1);

//     // Listen for the response from sandbox
//     channel.port1.onmessage = (e) => {
//       console.log("Reply reached from sandbox to offscreen:", e.data);
//       sendResponse(e.data); // Send response back to original sender
//       openPorts.delete(channel.port1);
//     };

//     // Post the message to sandbox, transferring port2
//     sandboxFrame.contentWindow.postMessage(
//       { cmd: msg.cmd, arg: msg.arg },
//       '*', // or specific origin
//       [channel.port2]
//     );
//     console.log("sended message to sandbox");

//     // Return true to indicate async response
//     return true;
//   }
// });

// // optional: listen for sandbox-originated notifications
// window.addEventListener('message', async (event) => {
//   const {data, ports} = event;
//   const port = ports && ports[0];
//   if (!port) return;

//   chrome.runtime.sendMessage(
//     {target: 'sidepanel', data}
//   ) 
// });

// offscreen.js (robust)
let sandboxFrame = document.getElementById('sandbox-iframe');
let sandboxReady = false;
const pendingMsgs = [];

// call once (or idempotent)
function ensureSandbox() {
  if (sandboxReady) return Promise.resolve();

  return new Promise((resolve, reject) => {
    if (!sandboxFrame) {
      sandboxFrame = document.createElement('iframe');
      sandboxFrame.id = 'sandbox-iframe';
      // allow scripts + same-origin so sandbox.html can call postMessage
      sandboxFrame.setAttribute('sandbox', 'allow-scripts allow-same-origin'); 
      sandboxFrame.src = chrome.runtime.getURL('sandbox.html');
      sandboxFrame.style.display = 'none';
      document.body.appendChild(sandboxFrame);
    }

    // timeout in case handshake never comes
    const to = setTimeout(() => {
      window.removeEventListener('message', onHandshake);
      reject(new Error('sandbox handshake timeout'));
    }, 8000);

    function onHandshake(ev) {
      const d = ev.data || {};
      if (d.__fromSandbox === true && d.type === 'sandbox-ready') {
        window.removeEventListener('message', onHandshake);
        clearTimeout(to);
        sandboxReady = true;
        resolve();

        // flush any queued messages
        while (pendingMsgs.length) {
          const { payload, ports, responder } = pendingMsgs.shift();
          _postToSandbox(payload, ports, responder);
        }
      }
    }

    window.addEventListener('message', onHandshake);
  });
}


function _postToSandbox(payload, transferList, responder) {
  if (!sandboxFrame || !sandboxFrame.contentWindow) {
    return responder && responder({ success:false, error: 'no-sandbox-window' });
  }
  try {
    sandboxFrame.contentWindow.postMessage(payload, '*', transferList || []);
    // we don't resolve here; response will be via the port
  } catch (e) {
    responder && responder({ success:false, error: e && e.message ? e.message : String(e) });
  }
}

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

// wire into runtime listener
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target === 'offscreen-internal') {
    console.log(`${msg.cmd} reached offscreen`);
    // If ensureSandbox is still pending, queue request
    if (!sandboxReady && sandboxFrame && !sandboxReady) {
      pendingMsgs.push({
        payload: { cmd: msg.cmd, arg: msg.arg },
        ports: null,
        responder: (r) => sendResponse(r)
      });
      // return true to keep channel open while queued
      return true;
    }
    // otherwise relay immediately (this returns true for async)
    relayToSandbox(msg, sendResponse);
    return true;
  }
});
