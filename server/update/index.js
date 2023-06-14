import fse from 'fs-extra'
import {$} from 'execa'

import isUmbrelHome from '../utilities/is-umbrel-home.js'

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

export default async function update({updateRoot, umbrelRoot}) {
  console.log(`Running migrations from "${updateRoot}" on "${umbrelRoot}"`)

  const filesToUpdate = [
    'scripts/start',
    'scripts/stop',
    'docker-compose.yml',
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

    await updateNetworkManager()
  }
}