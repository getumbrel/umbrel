import {URL} from 'node:url'
import crypto from 'node:crypto'

import fse from 'fs-extra'
import * as git from 'isomorphic-git'
import http from 'isomorphic-git/http/node'

import type Umbreld from '../index.js'
import randomToken from './utilities/random-token.js'

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
	url: string
	path: string

	constructor(umbreld: Umbreld, url: string) {
		if (!isValidUrl(url)) throw new Error('Invalid URL')
		this.#umbreld = umbreld
		this.url = url
		this.path = `${umbreld.dataDirectory}/app-stores/${this.cleanUrl()}`
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

	// Check if the app repo is behind the remote repo
	async isUpdated() {
		try {
			// Get the local commit
			const localBranch = await git.currentBranch({fs: fse, dir: this.path, fullname: true})
			const localCommit = await git.resolveRef({fs: fse, dir: this.path, ref: localBranch as string})

			// Get the remote commit
			const remoteRefs = await git.listServerRefs({http, url: this.url})
			const remoteCommit = remoteRefs.find((ref) => ref.ref === localBranch)!.oid

			return localCommit === remoteCommit
		} catch {
			// No matter what goes wrong just return false
			return false
		}
	}

	// Check if repo has been cloned
	async exists() {
		return fse.exists(`${this.path}/.git`)
	}

	// Update (or install) the repo
	async update() {
		const isUpdated = await this.isUpdated()
		if (!isUpdated) {
			await this.atomicClone()
		}

		return this.isUpdated()
	}
}
