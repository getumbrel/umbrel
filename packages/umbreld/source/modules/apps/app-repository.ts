import {URL} from 'node:url'
import crypto from 'node:crypto'

import fse from 'fs-extra'
import * as git from 'isomorphic-git'
import http from 'isomorphic-git/http/node/index.js'
import yaml from 'js-yaml'
import {globby} from 'globby'

import type Umbreld from '../../index.js'
import randomToken from '../utilities/random-token.js'
import {type AppRepositoryMeta, type AppManifest} from './schema.js'

async function readYaml(path: string) {
	return yaml.load(await fse.readFile(path, 'utf8'))
}

// TODO: Refactor some of this logic out into utilities

// Validate URL
function isValidUrl(url: string) {
	try {
		void new URL(url)
		return true
	} catch {
		return false
	}
}

export default class AppRepository {
	#umbreld: Umbreld
	logger: Umbreld['logger']
	url: string
	path: string

	constructor(umbreld: Umbreld, url: string) {
		if (!isValidUrl(url)) throw new Error('Invalid URL')
		this.#umbreld = umbreld
		this.url = url
		this.path = `${umbreld.dataDirectory}/app-stores/${this.cleanUrl()}`
		const {name} = this.constructor
		this.logger = umbreld.logger.createChildLogger(name.toLowerCase())
	}

	// Clean URL so it's safe to use as a directory name
	cleanUrl() {
		const {hostname, pathname} = new URL(this.url)
		const basename = hostname.split('.')[0]
		const username = pathname.split('/')[1]
		const repository = pathname.split('/')[2]?.replace(/\.git$/, '')
		const hash = crypto.createHash('sha256').update(this.url).digest('hex').slice(0, 8)

		let cleanUrl = ''
		if (username && repository) cleanUrl += `${username}-${repository}-`
		cleanUrl += `${basename}-${hash}`

		return (
			cleanUrl
				// Convert the URL to lowercase
				.toLowerCase()
				// Remove all characters that are not alphanumeric, dot, or hyphen
				.replace(/[^a-zA-Z0-9.-]/g, '')
		)
	}

	// Atomically clones the repository. This ensures that the repository is fully cloned
	// or not cloned at all, it will never be in a partial state while the clone is in progress.
	// Can also be used to atomically update instead of a pull.
	async atomicClone() {
		const temporaryPath = `${this.#umbreld.dataDirectory}/app-stores/.tmp/${randomToken(64)}`

		await git.clone({
			fs: fse,
			http,
			url: this.url,
			dir: temporaryPath,
			depth: 1,
			singleBranch: true,
		})

		await fse.move(temporaryPath, this.path, {overwrite: true})
	}

	// Get the current local commit
	async getCurrentCommit() {
		const localBranch = await git.currentBranch({fs: fse, dir: this.path, fullname: true})
		return git.resolveRef({fs: fse, dir: this.path, ref: localBranch as string})
	}

	// Get the latest remote commit from the default branch
	async checkLatestCommit() {
		const remoteRefs = await git.listServerRefs({http, url: this.url})
		const latestCommitInDefaultRemoteBranch = remoteRefs.find((ref) => ref.ref === 'HEAD')!.oid
		return latestCommitInDefaultRemoteBranch
	}

	// Check if the app repo is behind the remote repo
	async isUpdated() {
		try {
			const currentCommit = await this.getCurrentCommit()
			const latestCommit = await this.checkLatestCommit()
			return currentCommit === latestCommit
		} catch {
			// No matter what goes wrong just return false
			return false
		}
	}

	// Update (or install) the repo
	async update() {
		this.logger.verbose(`Checking for update for ${this.url}`)
		const isUpdated = await this.isUpdated()
		if (isUpdated) {
			this.logger.verbose(`${this.url} is already up to date`)
		} else {
			this.logger.verbose(`Newer version of ${this.url} available, updating`)
			try {
				await this.atomicClone()
			} catch (error) {
				this.logger.error(`Update failed for ${this.url}: ${(error as Error).message}`)
			}

			this.logger.verbose(`Updated ${this.url}!`)
		}

		return this.isUpdated()
	}

	// Read registry
	async readRegistry() {
		// Get repo metadata

		let meta: AppRepositoryMeta

		// Handle official repo which does not have meta
		// TODO: Instead of this hack we can probably just add this to the official repo
		// before we ship this code.
		if (this.url === 'https://github.com/getumbrel/umbrel-apps.git') {
			meta = {
				id: 'umbrel-app-store',
				name: 'Umbrel App Store',
			}
		} else {
			meta = (await readYaml(`${this.path}/umbrel-app-store.yml`)) as AppRepositoryMeta
		}

		// Read app manifests
		const appManifests = await globby(`${this.path}/*/umbrel-app.yml`)

		const parsedManifestsPromises = appManifests.map((manifest) =>
			readYaml(manifest).catch((error) => {
				this.logger.error(`Manifest parsing of ${manifest} failed: ${error.reason} on line ${error.mark.line}`)
			}),
		)

		let apps = (await Promise.all(parsedManifestsPromises)) as AppManifest[]

		apps = apps
			// Filter out invalid manifests
			.filter((app) => app !== undefined)
			// Add icons
			.map((app) => ({
				...app,
				gallery:
					meta.id === 'umbrel-app-store'
						? app.gallery.map((file) => `https://getumbrel.github.io/umbrel-apps-gallery/${app.id}/${file}`)
						: app.gallery,
				icon: app.icon ? app.icon : `https://getumbrel.github.io/umbrel-apps-gallery/${app.id}/icon.svg`,
			}))
			// Sort apps alphabetically
			.sort((a: any, b: any) => a.id.localeCompare(b.id))

		// TODO: Validate app manifest schema

		return {
			url: this.url,
			meta,
			apps,
		}
	}
}
