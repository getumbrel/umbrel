import {mkdtemp, open} from 'node:fs/promises'
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
const packageFiles = ['exports.sh', 'docker-compose.yml', 'umbrel-app.yml', 'app.env.template']
const dependencyExports = `export APP_BITCOIN_RPC_PORT=8332
export APP_TEST_INSTALLED_APPS="$("\${UMBREL_ROOT}/scripts/app" ls-installed | tr '\\n' ' ')"
export APP_TEST_USER_FILE="\${UMBREL_ROOT}/db/user.json"
export APP_TEST_EXPORTS_DIRECTORY="$(dirname "\${BASH_SOURCE[0]}")"
`
const template = `VALUE=\${APP_TEST_VALUE}
RPC_PORT=\${APP_BITCOIN_RPC_PORT}
INSTALLED_APPS=\${APP_TEST_INSTALLED_APPS}
USER_FILE=\${APP_TEST_USER_FILE}
EXPORTS_DIRECTORY=\${APP_TEST_EXPORTS_DIRECTORY}
`

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((directory) => fse.remove(directory)))
})

async function createFixture() {
	const root = await mkdtemp(path.join(tmpdir(), 'umbreld-app-update-'))
	temporaryDirectories.push(root)
	const appId = 'test-app'
	const appDirectory = path.join(root, 'app-data', appId)
	const dependencyDirectory = path.join(root, 'app-data', 'bitcoin')
	const repositoryDirectory = path.join(root, 'app-store', appId)
	const binDirectory = path.join(root, 'bin')
	const manifest = {manifestVersion: '1.0.0', id: appId, port: 1234, dependencies: ['bitcoin']}
	await Promise.all([
		fse.outputFile(path.join(root, 'db', 'umbrel-seed', 'seed'), 'test-seed'),
		fse.outputFile(path.join(root, 'umbrel.yaml'), yaml.dump({apps: ['bitcoin', appId]})),
		fse.outputFile(path.join(dependencyDirectory, 'umbrel-app.yml'), yaml.dump({id: 'bitcoin', version: '1.0.0'})),
		fse.outputFile(path.join(dependencyDirectory, 'exports.sh'), dependencyExports),
		fse.outputFile(path.join(appDirectory, 'umbrel-app.yml'), yaml.dump({...manifest, version: '1.0.0'})),
		fse.outputFile(
			path.join(appDirectory, 'docker-compose.yml'),
			yaml.dump({services: {server: {image: 'example/test:1'}}}),
		),
		fse.outputFile(path.join(appDirectory, 'exports.sh'), 'export APP_TEST_VALUE=original\n'),
		fse.outputFile(path.join(appDirectory, 'app.env.template'), 'ORIGINAL=${APP_TEST_VALUE}\n'),
		fse.outputFile(path.join(repositoryDirectory, 'umbrel-app.yml'), yaml.dump({...manifest, version: '2.0.0'})),
		fse.outputFile(
			path.join(repositoryDirectory, 'docker-compose.yml'),
			yaml.dump({services: {server: {image: 'example/test:2'}}}),
		),
		fse.outputFile(path.join(repositoryDirectory, 'exports.sh'), 'export APP_TEST_VALUE=updated\n', {mode: 0o640}),
		fse.outputFile(path.join(repositoryDirectory, 'app.env.template'), template),
		// The update paths may only request image pulls. Never contact Docker.
		fse.outputFile(
			path.join(binDirectory, 'docker'),
			`#!/usr/bin/env bash
if [[ "$1" != compose || "\${@: -1}" != pull ]]; then
  echo 'Unexpected Docker command' >&2
  exit 99
fi
exit 0
`,
			{mode: 0o755},
		),
	])

	return {
		root,
		appDirectory,
		dependencyDirectory,
		repositoryDirectory,
		async stubCommand(name: string, script: string) {
			await fse.outputFile(path.join(binDirectory, name), `#!/usr/bin/env bash\n${script}\n`, {mode: 0o755})
		},
		async run(command: 'pre-patch-update' | 'logs' = 'pre-patch-update', boundedLogs = false) {
			const args =
				command === 'logs'
					? [command, appId, ...(boundedLogs ? ['1024'] : [])]
					: [command, appId, '--skip-stop', '--skip-start']
			return execa(scriptPath, args, {
				reject: false,
				env: {
					PATH: `${binDirectory}${path.delimiter}${process.env.PATH}`,
					SCRIPT_UMBREL_ROOT: root,
					SCRIPT_APP_REPO_DIR: repositoryDirectory,
					SCRIPT_DOCKER_FRAGMENTS: scriptDirectory,
					SCRIPT_APP_DATA_ROOTS: JSON.stringify({
						[appId]: path.join(appDirectory, 'data'),
						bitcoin: path.join(dependencyDirectory, 'data'),
					}),
					REMOTE_TOR_ACCESS: 'false',
				},
			})
		},
		async expectNoTemporaryFiles() {
			for (const directory of [appDirectory, dependencyDirectory]) {
				expect(await fse.readdir(directory)).not.toContainEqual(expect.stringContaining('.tmp.'))
			}
		},
	}
}

describe('app update file integrity', () => {
	test('sources dependency exports without modifying them and preserves legacy path behavior', async () => {
		const fixture = await createFixture()
		const exportsPath = path.join(fixture.dependencyDirectory, 'exports.sh')
		const reader = await open(exportsPath)
		try {
			const before = await reader.stat()
			const result = await fixture.run()

			expect(result.exitCode, result.stderr).toBe(0)
			expect(await fse.readFile(exportsPath, 'utf8')).toBe(dependencyExports)
			expect((await fse.stat(exportsPath)).ino).toBe(before.ino)
			expect(await fse.readFile(path.join(fixture.appDirectory, 'app.env'), 'utf8')).toBe(
				`VALUE=updated\nRPC_PORT=8332\nINSTALLED_APPS=bitcoin test-app \nUSER_FILE=${fixture.root}/umbrel.yaml\nEXPORTS_DIRECTORY=${fixture.dependencyDirectory}\n`,
			)
			await fixture.expectNoTemporaryFiles()
		} finally {
			await reader.close()
		}
	})

	test('keeps existing readers on complete old files while publishing new package files', async () => {
		const fixture = await createFixture()
		const readers = await Promise.all(
			packageFiles.map(async (name) => ({
				name,
				before: await fse.readFile(path.join(fixture.appDirectory, name), 'utf8'),
				reader: await open(path.join(fixture.appDirectory, name)),
			})),
		)
		try {
			const result = await fixture.run()
			expect(result.exitCode, result.stderr).toBe(0)
			for (const {name, before, reader} of readers) {
				// An inode check after the whole update could also pass if sed -i
				// replaced the file after cp had already truncated it. Keep a reader
				// open across the update to verify its original bytes survive.
				expect(await reader.readFile('utf8'), name).toBe(before)
				expect(await fse.readFile(path.join(fixture.appDirectory, name), 'utf8'), name).toBe(
					await fse.readFile(path.join(fixture.repositoryDirectory, name), 'utf8'),
				)
			}
			expect((await fse.stat(path.join(fixture.appDirectory, 'exports.sh'))).mode & 0o777).toBe(0o640)
			await fixture.expectNoTemporaryFiles()
		} finally {
			await Promise.all(readers.map(({reader}) => reader.close()))
		}
	})

	test('leaves the installed file intact and removes a partial copy when copying fails', async () => {
		const fixture = await createFixture()
		const copyCommand = process.platform === 'darwin' ? 'gcp' : 'cp'
		const {stdout: realCopy} = await execa('which', [copyCommand])
		await fixture.stubCommand(
			copyCommand,
			`
if [[ "\${2##*/}" == exports.sh ]]; then
  destination="$3"
  [[ ! -d "$destination" ]] || destination="$destination/exports.sh"
  printf '# incomplete copy\\n' > "$destination"
  exit 38
fi
exec '${realCopy}' "$@"`,
		)

		const result = await fixture.run()

		expect(result.exitCode).toBe(38)
		expect(await fse.readFile(path.join(fixture.appDirectory, 'exports.sh'), 'utf8')).toBe(
			'export APP_TEST_VALUE=original\n',
		)
		await fixture.expectNoTemporaryFiles()
	})

	test('cleans up a transformed exports file when sed fails', async () => {
		const fixture = await createFixture()
		await fixture.stubCommand('sed', 'exit 41')

		const result = await fixture.run('logs')

		expect(result.exitCode).toBe(41)
		expect(await fse.readFile(path.join(fixture.dependencyDirectory, 'exports.sh'), 'utf8')).toBe(dependencyExports)
		await fixture.expectNoTemporaryFiles()
	})

	test('leaves the installed file intact and cleans up when publishing fails', async () => {
		const fixture = await createFixture()
		const {stdout: realMove} = await execa('which', ['mv'])
		await fixture.stubCommand('mv', `if [[ "\${@: -1}" == */exports.sh ]]; then exit 39; fi\nexec '${realMove}' "$@"`)

		const result = await fixture.run()

		expect(result.exitCode).toBe(39)
		expect(await fse.readFile(path.join(fixture.appDirectory, 'exports.sh'), 'utf8')).toBe(
			'export APP_TEST_VALUE=original\n',
		)
		await fixture.expectNoTemporaryFiles()
	})

	test('does not let exports subshells remove the active parent source file', async () => {
		const fixture = await createFixture()
		await fse.writeFile(
			path.join(fixture.repositoryDirectory, 'exports.sh'),
			'(exit 0)\ncat "${BASH_SOURCE[0]}" > /dev/null\nexport APP_TEST_VALUE=updated\n',
		)

		const result = await fixture.run()

		expect(result.exitCode, result.stderr).toBe(0)
		await fixture.expectNoTemporaryFiles()
	})

	test('cleans up exports created in the bounded logs pipeline when sourcing fails', async () => {
		const fixture = await createFixture()
		await fse.writeFile(path.join(fixture.appDirectory, 'exports.sh'), 'return 37\n')

		const result = await fixture.run('logs', true)

		expect(result.exitCode).toBe(37)
		await fixture.expectNoTemporaryFiles()
	})

	test.each(['INT', 'TERM'])('cleans up transformed exports when logs receives SIG%s', async (signal) => {
		const fixture = await createFixture()
		await fse.writeFile(path.join(fixture.appDirectory, 'exports.sh'), `kill -${signal} "$$"\n`)

		const result = await fixture.run('logs')

		expect(result.signal).toBe(`SIG${signal}`)
		await fixture.expectNoTemporaryFiles()
	})

	describe.each([0, 37])('existing EXIT handlers with exit status %i', (exitCode) => {
		test.each([';', ' # trailing comment'])('preserves a handler ending in %s', async (ending) => {
			const fixture = await createFixture()
			await fse.writeFile(
				path.join(fixture.dependencyDirectory, 'exports.sh'),
				`trap 'printf "%s\\n" "$?" > "\${UMBREL_ROOT}/trap-status"${ending}' EXIT\n`,
			)
			await fse.writeFile(path.join(fixture.appDirectory, 'exports.sh'), `return ${exitCode}\n`)
			await fixture.stubCommand('docker', 'exit 0')

			const result = await fixture.run('logs')

			expect(result.exitCode, result.stderr).toBe(exitCode)
			expect(result.stderr).toBe('')
			expect(await fse.readFile(path.join(fixture.root, 'trap-status'), 'utf8')).toBe(`${exitCode}\n`)
			await fixture.expectNoTemporaryFiles()
		})
	})

	test.each(['', '# no action'])('cleans up with an existing no-op EXIT handler: %j', async (handler) => {
		const fixture = await createFixture()
		await fse.writeFile(path.join(fixture.dependencyDirectory, 'exports.sh'), `trap '${handler}' EXIT\n`)
		await fse.writeFile(path.join(fixture.appDirectory, 'exports.sh'), 'return 37\n')

		const result = await fixture.run('logs')

		expect(result.exitCode, result.stderr).toBe(37)
		expect(result.stderr).toBe('')
		await fixture.expectNoTemporaryFiles()
	})

	test.each(['INT', 'TERM'])('keeps SIG%s ignored without removing active exports', async (signal) => {
		const fixture = await createFixture()
		await fse.writeFile(path.join(fixture.dependencyDirectory, 'exports.sh'), `trap '' ${signal}\n`)
		await fse.writeFile(
			path.join(fixture.appDirectory, 'exports.sh'),
			`kill -${signal} "$$"\ncat "\${BASH_SOURCE[0]}" > /dev/null\nreturn 37\n`,
		)

		const result = await fixture.run('logs')

		expect(result.exitCode, result.stderr).toBe(37)
		expect(result.signal).toBeUndefined()
		expect(result.stderr).toBe('')
		await fixture.expectNoTemporaryFiles()
	})
})
