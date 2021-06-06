const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const createNode = html => {
  const container = document.createElement('div');
  container.innerHTML = html;
  return container.children[0];
};

const getUmbrelStatus = async () => {
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
        'no-file': `<b>Error:</b> Couldn't find some file...`,
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
  on('.shutdown', 'click', shutdown);
  on('.restart', 'click', restart);

  while (true) {
    try {
      const [
        isUmbrelUp,
        status,
      ] = await Promise.all([
        getUmbrelStatus(),
        getStatus(),
      ]);

      if (isUmbrelUp) {
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
