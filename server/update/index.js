import fse from 'fs-extra'
import {$} from 'execa'
import pRetry from 'p-retry'

import isUmbrelHome from '../utilities/is-umbrel-home.js'

async function copyFromOverlay({updateRoot, path}) {
  const overlayRoot = `${updateRoot}/server/update/umbrel-os-overlay`
  return fse.copy(`${overlayRoot}${path}`, path)
}

async function updateNetworkManager() {
  console.log('Patching network-manager to use dhclient...')

  const configPath = '/etc/NetworkManager/NetworkManager.conf'
  const configContents = `[main]
plugins=ifupdown,keyfile
dhcp=dhclient

[ifupdown]
managed=false
`
  if (!await fse.pathExists(configPath)) {
    return console.log(`Skipping because config file doesn't exist`)
  }
  if((await fse.readFile(configPath, 'utf8')).includes('dhcp=dhclient')) {
    return console.log(`Skipping because config file is already using dhclient`)
  }
  await fse.writeFile(configPath, configContents)
  console.log('Restarting network-manager...')
  await $`systemctl restart NetworkManager`
}

async function activatePowerButtonRecovery({updateRoot}) {
  console.log('Activating power button recovery...')

  console.log('Registering acpi event handlers...')
  await copyFromOverlay({updateRoot, path: '/etc/acpi/events/power-button'})
  await copyFromOverlay({updateRoot, path: '/etc/acpi/power-button.sh'})
  console.log('Installing acpid...')
  await $`apt-get update --yes`
  await $`apt-get install --yes acpid`
  await $`systemctl restart acpid`

  console.log('Telling logind to ignore power button presses...')
  await copyFromOverlay({updateRoot, path: '/etc/systemd/logind.conf.d/power-button.conf'})
  await $`systemctl restart systemd-logind`
}

export default async function update({updateRoot, umbrelRoot}) {
  console.log(`Running migrations from "${updateRoot}" on "${umbrelRoot}"`)

  const filesToUpdate = [
    'scripts/start',
    'scripts/stop',
    'docker-compose.yml',
    'docker-compose.dev.yml',
    'packages',
  ]

  for (const file of filesToUpdate) {
    const updatePath = `${updateRoot}/${file}`
    const umbrelPath = `${umbrelRoot}/${file}`

    console.log(`Updating "${umbrelPath}"...`)

    await fse.copy(updatePath, umbrelPath)
  }

  // Umbrel Home specific updates
  if (await isUmbrelHome()) {
    console.log('Running Umbrel Home specific migrations...')

    await pRetry(() => updateNetworkManager(), {
      retries: 3,
    })

    await pRetry(() => activatePowerButtonRecovery({updateRoot}), {
        retries: 3,
    })
  }
}