import {mkdtemp} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

import {execa} from 'execa'
import fse from 'fs-extra'
import yaml from 'js-yaml'
import {afterEach, describe, expect, test} from 'vitest'

const scriptDirectory = fileURLToPath(new URL('.', import.meta.url))
const scriptPath = path.join(scriptDirectory, 'app-script')
const temporaryDirectories: string[] = []

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((directory) => fse.remove(directory)))
})

async function updateApp(
	command: 'update' | 'pre-patch-update',
	{
		exports = 'export APP_TEST_VALUE=updated\n',
		failTemplate = false,
		failPull = false,
	}: {exports?: string; failTemplate?: boolean; failPull?: boolean} = {},
) {
	const root = await mkdtemp(path.join(tmpdir(), 'umbreld-update-errors-'))
	temporaryDirectories.push(root)
	const appId = 'test-app'
	const appDirectory = path.join(root, 'app-data', appId)
	const repositoryDirectory = path.join(root, 'app-store', appId)
	const binDirectory = path.join(root, 'bin')
	const manifest = {manifestVersion: '1.0.0', id: appId, port: 1234}
	const compose = {services: {server: {image: 'example/test:1'}}}
	await Promise.all([
		fse.outputFile(path.join(root, 'db', 'umbrel-seed', 'seed'), 'test-seed'),
		fse.outputFile(path.join(root, 'umbrel.yaml'), yaml.dump({apps: [appId]})),
		fse.outputFile(path.join(appDirectory, 'umbrel-app.yml'), yaml.dump({...manifest, version: '1.0.0'})),
		fse.outputFile(path.join(appDirectory, 'docker-compose.yml'), yaml.dump(compose)),
		fse.outputFile(path.join(appDirectory, 'exports.sh'), 'export APP_TEST_VALUE=original\n'),
		fse.outputFile(path.join(repositoryDirectory, 'umbrel-app.yml'), yaml.dump({...manifest, version: '2.0.0'})),
		fse.outputFile(path.join(repositoryDirectory, 'docker-compose.yml'), yaml.dump(compose)),
		fse.outputFile(path.join(repositoryDirectory, 'exports.sh'), exports),
		fse.outputFile(path.join(repositoryDirectory, 'app.env.template'), 'VALUE=${APP_TEST_VALUE}\n'),
		// The script may only request an image pull. Never contact a Docker daemon.
		fse.outputFile(
			path.join(binDirectory, 'docker'),
			`#!/usr/bin/env bash
if [[ "$1" != compose || "\${@: -1}" != pull ]]; then
  echo 'Unexpected Docker command' >&2
  exit 99
fi
exit ${failPull ? 43 : 0}
`,
			{mode: 0o755},
		),
	])
	if (failTemplate) {
		await fse.outputFile(path.join(binDirectory, 'envsubst'), '#!/bin/sh\nexit 42\n', {mode: 0o755})
	}

	const result = await execa(scriptPath, [command, appId, '--skip-stop', '--skip-start'], {
		reject: false,
		env: {
			PATH: `${binDirectory}${path.delimiter}${process.env.PATH}`,
			SCRIPT_UMBREL_ROOT: root,
			SCRIPT_APP_REPO_DIR: repositoryDirectory,
			SCRIPT_DOCKER_FRAGMENTS: scriptDirectory,
			SCRIPT_APP_DATA_ROOTS: JSON.stringify({[appId]: path.join(appDirectory, 'data')}),
			REMOTE_TOR_ACCESS: 'false',
		},
	})
	const installedManifest = yaml.load(await fse.readFile(path.join(appDirectory, 'umbrel-app.yml'), 'utf8'))
	return {result, installedManifest, appDirectory}
}

describe.each(['update', 'pre-patch-update'] as const)('%s failures', (command) => {
	test.each([
		{name: 'an explicit return', exports: 'return 37\n', exitCode: 37},
		{name: 'a failed command before a successful one', exports: 'false\nexport APP_TEST_VALUE=updated\n', exitCode: 1},
	])('preserves $name in exports and leaves the previous manifest installed', async ({exports, exitCode}) => {
		const {result, installedManifest} = await updateApp(command, {exports})

		expect(result.exitCode).toBe(exitCode)
		expect(installedManifest).toMatchObject({version: '1.0.0'})
	})

	test('preserves a template error and leaves the previous manifest installed', async () => {
		const {result, installedManifest} = await updateApp(command, {failTemplate: true})

		expect(result.exitCode).toBe(42)
		expect(installedManifest).toMatchObject({version: '1.0.0'})
	})

	test.each(['INT', 'TERM'])('does not publish the new manifest when interrupted by SIG%s', async (signal) => {
		const {result, installedManifest} = await updateApp(command, {exports: `kill -${signal} "$$"\n`})

		expect(result.signal).toBe(`SIG${signal}`)
		expect(installedManifest).toMatchObject({version: '1.0.0'})
	})

	test('publishes the new manifest after successfully preparing the app files', async () => {
		const {result, installedManifest, appDirectory} = await updateApp(command)

		expect(result.exitCode, result.stderr).toBe(0)
		expect(installedManifest).toMatchObject({version: '2.0.0'})
		expect(await fse.readFile(path.join(appDirectory, 'app.env'), 'utf8')).toBe('VALUE=updated\n')
	})
})

test('legacy update preserves an image pull failure and leaves the previous manifest installed', async () => {
	const {result, installedManifest} = await updateApp('update', {failPull: true})

	expect(result.exitCode).toBe(43)
	expect(installedManifest).toMatchObject({version: '1.0.0'})
})
