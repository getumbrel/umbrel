#!/usr/bin/env ts-node
import process from 'node:process'
import path from 'node:path'

import caxa from 'caxa'
import fse from 'fs-extra'
import {$} from 'execa'

const $$ = $({stdio: 'inherit'})

const BUILD_DIRECTORY = 'build'

async function runMultiArchDockerBuilds(architectures) {
	let buildDirectory = BUILD_DIRECTORY
	if (architectures.length === 1) buildDirectory += `/linux_${architectures[0]}`
	const platforms = architectures.map((architecture) => `linux/${architecture}`).join(',')
	await $$`docker buildx build --platform ${platforms} --output ${buildDirectory} .`
}

async function buildBinary() {
	const {bin} = await fse.readJson('package.json')
	const entrypoint = path.join('{{caxa}}', bin)
	await caxa({
		input: '.',
		exclude: [BUILD_DIRECTORY],
		output: `${BUILD_DIRECTORY}/umbreld`,
		command: ['env', 'PATH={{caxa}}/node_modules/.bin/:$PATH', '{{caxa}}/node_modules/.bin/ts-node', entrypoint],
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
