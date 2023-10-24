import {fileURLToPath} from 'node:url'
import path from 'node:path'
import fse from 'fs-extra'
import {Git} from 'node-git-server'
import getPort from 'get-port'
import waitPort from 'wait-port'
import {$} from 'execa'
import temporaryDirectory from '../utilities/temporary-directory.js'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const directory = temporaryDirectory()

export default async function runGitServer() {
	// Create root dir to run git server
	const gitServerDirectory = await directory.create()

	// Create subdirectory for the repo
	const repoDirectory = `${gitServerDirectory}/umbrel-apps.git`
	await fse.ensureDir(repoDirectory)

	// Copy in community repo skeleton fixture and commit it
	await fse.copy(`${currentDirectory}/fixtures/community-repo`, repoDirectory)
	const $$ = $({cwd: repoDirectory})
	await $$`git init`
	await $$`git add .`
	await $$`git config user.name "Your Name"`
	await $$`git config user.email "you@example.com"`
	await $$`git commit -m ${'Initial commit'}`

	// Run git server and wait for it to come online
	const repos = new Git(gitServerDirectory)
	const port = await getPort()
	repos.listen(port)
	await waitPort({host: 'localhost', port})

	// Return useful properties
	return {
		url: `http://localhost:${port}/umbrel-apps.git`,
		directory: repoDirectory,
		async addNewCommit() {
			await $$`git commit --allow-empty -m ${'New commit'}`
		},
		async close() {
			await repos.close()
			await directory.destroyRoot()
		},
	}
}
