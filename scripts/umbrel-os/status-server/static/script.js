const isIframe = (window.self !== window.top);

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const on = (selector, eventName, callback) => {
  for (element of document.querySelectorAll(selector)) {
    element.addEventListener(eventName, event => {
      event.preventDefault();
      callback();
    });
  }
};

const setState = (key, value) => document.body.dataset[key] = value;
const getState = key => document.body.dataset[key];

const isUmbrelUp = async () => {
  const response = await fetch('/manager-api/ping');
  return response.status === 200;
};

const checkForError = async () => {
  const response = await fetch('/status');
  const status = await response.json();
  const errorCode = (status.find(service => service.status === 'errored') || {}).error;
  return errorCode;
};

const isStatusServerUp = async () => {
  try {
    await checkForError();
    return true;
  } catch (e) {
    return false;
  }
};

const power = async action => {
  try {
    const token = await (await fetch('/token')).json();
    const response = await fetch(`/${action}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({token}),
    });
    if (!response.ok) {
      return false;
    }
  } catch (e) {} finally {
    return true;
  }
};

on('.shutdown', 'click', async () => {
  if (! await power('shutdown')) {
    alert('Failed to shutdown Umbrel');
    return;
  }

  setState('status', 'shutting-down');
  await delay(30000);
  setState('status', 'shutdown-complete');
});

on('.restart', 'click', async () => {
  if (! await power('restart')) {
    alert('Failed to restart Umbrel');
    return;
  }

  setState('status', 'restarting');
  await delay(10000);
  // Wait for Umbrel to come back up then reload the page.
  while (true) {
    try {
      if (await isStatusServerUp() || await isUmbrelUp()) {
        window.location.reload();
      }
    } catch (e) {}
    await delay(1000);
  }
});

const main = async () => {
  // Protect against clickjacking
  if (isIframe) {
    document.body.innerText = 'For security reasons Umbrel doesn\'t work in an iframe.';
    return;
  }

  // Set initial loading state
  setState('status', 'starting');

  // Start loop
  while (getState('status') === 'starting') {
    try {
      // If Umbrel is ready, reload
      if (await isUmbrelUp()) {
        window.location.reload();
      }

      // If there are errors, set error state
      const error = await checkForError();
      if (error) {
        setState('status', 'error');
        setState('error', error);
      }
    } catch (e) {
      console.error(e);
    }
    await delay(1000);
  }
};

main();
