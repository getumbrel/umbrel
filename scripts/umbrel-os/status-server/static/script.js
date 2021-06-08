const isIframe = (window.self !== window.top);

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const createNode = html => {
  const container = document.createElement('div');
  container.innerHTML = html;
  return container.children[0];
};

const isUmbrelUp = async () => {
  const response = await fetch('/manager-api/ping');
  return response.status === 200;
};

const getStatus = async () => {
  const response = await fetch('/status');
  return response.json();
};

const getCsrfToken = async () => {
    const response = await fetch('/token');
    return response.json();
};

const post = async endpoint => fetch(endpoint, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    token: await getCsrfToken()
  }),
});

let doingShutdown = false;

const showShutdown = async () => {
  doingShutdown = true;
  const shutdownElem = document.querySelector('.shutting-down');
  shutdownElem.classList.remove('hidden');
  shutdownElem.classList.add('fade-in');
  await delay(10000);
  shutdownElem.querySelector('.logo').style.filter = 'grayscale(1)';
  shutdownElem.querySelector('.spinner').remove()
  shutdownElem.querySelector('.title').innerText = 'Shutdown Complete';
};

const shutdown = async () => {
  const response = await post('/shutdown');
  if (!response.ok) {
    alert('Failed to shutdown Umbrel');
    return;
  }
  showShutdown();
};

const restart = async () => {
  const response = await post('/restart');
  if (!response.ok) {
    alert('Failed to restart Umbrel');
    return;
  }
  showShutdown();
};

const on = (selector, eventName, callback) => {
  document.querySelector(selector).addEventListener(eventName, event => {
    event.preventDefault();
    callback();
  });
};

const render = status => {
  const services = document.querySelector('.services');
  // Remove any elements that no longer exist
  const ids = status.map(service => service.id);
  services.querySelectorAll(`.service`).forEach(node => {
    if (!ids.includes(node.dataset.service)) {
      node.remove();
    }
  });

  // Add/update statuses
  status.forEach(service => {
    // Create a new node if it doesn't already exist
    let node = services.querySelector(`.service[data-service="${service.id}"]`);
    if (!node) {
      node = createNode(`
      <div data-service="${service.id}" class="service fade-in">
        <div class="card">
          <span class="icon"></span>
          <span class="title"></span>
        </div>
      </div>
      `);
      services.append(node);
    }

    // Render title
    const titles = {
      mount: 'Mounting external storage',
      'sdcard-update': 'Checking SD card for update',
      umbrel: 'Starting Umbrel',
    };
    node.querySelector('.title').innerText = titles[service.id];

    // Render icon
    const icons = {
      started: '⏳',
      errored: '🚫',
      completed: '✅',
    };
    node.querySelector('.icon').classList[service.status == 'started' ? 'add' : 'remove']('rotate');
    node.querySelector('.icon').innerText = icons[service.status];

    // Render Error
    if(service.status === 'errored' && !node.querySelector('.error')) {
      const errorTemplates = {
        'monitor-check': `
          <b>Error:</b> External storage device check failed.
          <p>This can sometimes be caused by using an unofficial power supply.</p>
        `,
        'semver-mismatch': `
          <b>Error:</b> Can't upgrade from SDcard due to version mismatch.
        `,
        'no-block-device': `
          <b>Error:</b> Umbrel couldn't find a storage device attached.
          Please make sure your device is attached and then reboot.
        `,
        'multiple-block-devices': `
          <b>Error:</b> Umbrel found multiple storage devices attached.
          Please remove one of them and reboot.
        `,
        'rebinding-failed': `
          <b>Error:</b> Umbrel failed to use your storage device in low power mode.
          Are you using the recommended hardware?
        `,
      };

      if (errorTemplates[service.error]) {
        node.appendChild(createNode(`
          <div class="error card fade-in">
            ${errorTemplates[service.error]}
          </div>
        `));
      }
    }
  });

  // Toggle button visibility
  const isError = Boolean(status.find(service => service.status === 'errored'));
  document.querySelector('.header').classList[isError ? 'remove' : 'add']('hidden');
};

const main = async () => {
  if (isIframe) {
    document.body.innerText = 'For security reasons Umbrel doesn\'t work in an iframe.';
    return;
  }
  on('.shutdown', 'click', shutdown);
  on('.restart', 'click', restart);

  while (true) {
    try {
      if (await isUmbrelUp()) {
        window.location.reload();
      }

      const status = await getStatus();
      if(doingShutdown) {
        // If the reques suceeds after shutdown it means the server is back up
        // so we should reload.
        window.location.reload();
      }
      render(status);
    } catch (e) {
      console.error(e);
    }
    await delay(1000);
  }
};

main();
