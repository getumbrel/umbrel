#!/usr/bin/env node
import path from 'node:path'
import os from 'node:os'

import caxa from 'caxa'
import fse from 'fs-extra'
import {$} from 'execa'

const $$ = $({stdio: 'inherit'})

const BUILD_DIRECTORY = 'build'

async function runMultiArchDockerBuilds(architectures) {
  const platforms = architectures.map(architecture => `linux/${architecture}`).join(',')
  await $$`docker buildx build --platform ${platforms} --output ${BUILD_DIRECTORY} .`
  // Clean up Docker's platform-specific build directories
  for (const buildSubDirectory of await fse.readdir(BUILD_DIRECTORY)) {
    const platformBuildPath = `${BUILD_DIRECTORY}/${buildSubDirectory}`
    const isPlatformBuild = buildSubDirectory.startsWith('linux_') && (await fse.stat(platformBuildPath)).isDirectory()
    if (!isPlatformBuild) continue
    for (const file of await fse.readdir(platformBuildPath)) {
      await fse.move(`${platformBuildPath}/${file}`, `${BUILD_DIRECTORY}/${file}`, { overwrite: true })
    }
    await fse.remove(platformBuildPath)
  }
}

async function buildBinary() {
  const {bin} = await fse.readJson('package.json')
  const entrypoint = path.join('{{caxa}}', bin)
  const architecture = os.arch() === 'x64' ? 'amd64' : os.arch()
  await caxa({
    input: '.',
    exclude: [BUILD_DIRECTORY],
    output: `${BUILD_DIRECTORY}/umbreld-${architecture}`,
    command: [
      "{{caxa}}/node_modules/.bin/node",
      entrypoint,
    ],
  })
}

async function main() {
  const isNativeBuild = process.argv.includes('--native')

  if (isNativeBuild) {
    await buildBinary()
  } else {
    let architectures = ['amd64', 'arm64']
    if (process.argv.includes('--architectures')) {
      architectures = process.argv[process.argv.indexOf('--architectures') + 1].split(',')
    }
    await runMultiArchDockerBuilds(architectures)
  }
}

await main()