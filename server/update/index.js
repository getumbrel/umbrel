import fse from 'fs-extra'

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
}