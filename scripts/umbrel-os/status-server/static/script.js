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

const shutdown = async () => {
  const response = await fetch('/shutdown', {method: 'POST'});
  if (!response.ok) {
    alert('Failed to shutdown Umbrel');
    return;
  }
  // TODO: Show shutdown UI feedback
};

const restart = async () => {
  const response = await fetch('/restart', {method: 'POST'});
  if (!response.ok) {
    alert('Failed to restart Umbrel');
    return;
  }
  // TODO: Show restart UI feedback
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
          <p>This can sometimes be cause by using an unnoficial power supply.</p>
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
          Are you using the reccomended hardware?
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

  // Togle button visiblity
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
      render(status);
    } catch (e) {
      console.error(e);
    }
    await delay(1000);
  }
};

main();
