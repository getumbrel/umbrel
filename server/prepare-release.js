#!/usr/bin/env node
import fse from 'fs-extra'
import {$} from 'execa'

const BUILD_DIRECTORY = 'build'
const RELEASE_DIRECTORY = 'release'

async function main() {
  const release = process.argv[2]

  if (!release) throw new Error('Release argument is required.')
  
  console.log('Cleaning release directory...')
  await fse.remove(RELEASE_DIRECTORY)
  await fse.ensureDir(RELEASE_DIRECTORY)

  console.log('Preparing release assets...')
  await Promise.all([
    $`tar -czvf ${RELEASE_DIRECTORY}/umbreld-${release}-amd64.tar.gz -C ${BUILD_DIRECTORY}/linux_amd64 umbreld`,
    $`tar -czvf ${RELEASE_DIRECTORY}/umbreld-${release}-arm64.tar.gz -C ${BUILD_DIRECTORY}/linux_arm64 umbreld`,
    $`git archive --format=tar.gz --output ${RELEASE_DIRECTORY}/umbrel-${release}.tar.gz --prefix=umbrel-${release}/ HEAD`,
  ])

  console.log('Generating checksums...')
  const releaseAssets = await fse.readdir(RELEASE_DIRECTORY)
  const checksums = await $({cwd: RELEASE_DIRECTORY})`sha256sum ${releaseAssets}`
  console.log(checksums.stdout)
  await fse.writeFile(`${RELEASE_DIRECTORY}/SHA256SUMS`, checksums.stdout)
}

await main()