// TODO(developer): Set to client ID and API key from the Developer Console
const CLIENT_ID = '994791922456-p3f5keiv53i47ugp4c9qv0ve0f5limu4.apps.googleusercontent.com';
const API_KEY = 'AIzaSyBOVlZp5juakTxRzHayCYRjqtMlynETBuc';

let tokenClient;
let gapiInited = false;
let gisInited = false;

document.getElementById('authorize_button').style.visibility = 'hidden';
document.getElementById('signout_button').style.visibility = 'hidden';

/**
 * Enables user interaction after all libraries are loaded.
 */
function maybeEnableButtons() {
if (gapiInited && gisInited) {
    document.getElementById('authorize_button').style.visibility = 'visible';
    document.getElementById('signout_button').style.visibility = 'visible';
}
}

/**
 * Print task lists.
 */
async function fetchTaskLists() {
let response;
try {
    response = await gapi.client.tasks.tasklists.list({
    'maxResults': 10,
    });
} catch (err) {
    document.getElementById('content').innerText = err.message;
    return;
}
const taskLists = response.result.items;
if (!taskLists || taskLists.length == 0) {
    document.getElementById('content').innerText = 'No task lists found.';
    return;
}
// Flatten to string to display
const output = taskLists.reduce(
    (str, taskList) => `${str}${taskList.title} (${taskList.id})\n`,
    'Task lists:\n');
document.getElementById('content').innerText = output;
}

async function sandboxFunctionCaller(functionNeeded, arg) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
            { target: 'offscreen', cmd: functionNeeded, arg: arg },
        );

        function handler(event) {
            const msg = event.data;
            if (msg?.target === 'sidepanel-internal') {
                window.removeEventListener('message', handler); // cleanup

                if (msg.success) {
                    console(msg.result);
                    resolve(msg.result);
                } else {
                    console.error(msg.result);
                    resolve(false);
                }
            }
        }

        window.addEventListener('message', handler);
    });
}


document.addEventListener("DOMContentLoaded", async function() {
    console.log("window loaded");
    try {
        gapiInited = await sandboxFunctionCaller('gapiLoaded', CLIENT_ID);

        const gisLoadRes = await sandboxFunctionCaller('gisLoaded', CLIENT_ID);
        tokenClient = gisLoadRes === false ? null : gisLoadRes;
        gisInited = gisLoadRes !== false;

        console.log("gapiInited:", gapiInited);
        console.log("gisInited:", gisInited);
        maybeEnableButtons();
    } catch (err) {
        console.error("Init error:", err);
    }
});

document.getElementById('authorize_button').onclick = () => sandboxFunctionCaller('handleAuthClick', tokenClient);
document.getElementById('signout_button').onclick = () => sandboxFunctionCaller('handleSignoutClick', tokenClient);