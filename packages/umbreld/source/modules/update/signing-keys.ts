import fse from 'fs-extra'

import type Umbreld from '../../index.ts'
import runEvery from '../utilities/run-every.ts'
import {writeFileDurably} from '../utilities/durable-filesystem.ts'
import {
	BUNDLED_SIGNING_KEYS_PATH,
	ROOT_PUBLIC_KEY,
	SIGNING_KEYS_URLS,
	newestSigningKeysList,
	readText,
	verifySigningKeysList,
	type SigningKeysList,
} from './release-signing.ts'

// The approved signing keys list the device trusts: the newest one signed by the root key out of the
// list this release shipped with, the device's saved copy, every published source and the lists releases
// carry with their signatures
export default class SigningKeys {
	#umbreld: Umbreld
	readonly rootPublicKey: string
	#signingKeysUrls: string[]
	#bundledSigningKeysPath: string
	#stopRefreshing?: () => void
	#refreshing?: Promise<SigningKeysList>
	#saving: Promise<unknown> = Promise.resolve()
	// The newest list this has seen if saving it failed, like on a full disk
	#unsaved?: SigningKeysList
	logger: Umbreld['logger']

	constructor(
		umbreld: Umbreld,
		{
			rootPublicKey = ROOT_PUBLIC_KEY,
			signingKeysUrls = SIGNING_KEYS_URLS,
			bundledSigningKeysPath = BUNDLED_SIGNING_KEYS_PATH,
		} = {},
	) {
		this.#umbreld = umbreld
		this.rootPublicKey = rootPublicKey
		this.#signingKeysUrls = signingKeysUrls
		this.#bundledSigningKeysPath = bundledSigningKeysPath
		const {name} = this.constructor
		this.logger = umbreld.logger.createChildLogger(`update:${name.toLowerCase()}`)
	}

	get #savedSigningKeysPath() {
		return `${this.#umbreld.dataDirectory}/umbrelos-signing-keys.txt`
	}

	async start() {
		this.#stopRefreshing = runEvery('1 day', async () => {
			await this.refresh().catch((error) => this.logger.error('Failed to refresh signing keys', error))
		})
	}

	async stop() {
		this.#stopRefreshing?.()
	}

	// The newest valid list the device has: its saved copy, the one this release shipped with or one it
	// couldn't save
	async get() {
		const lists = await Promise.all(
			[this.#savedSigningKeysPath, this.#bundledSigningKeysPath].map(async (file) => {
				try {
					return verifySigningKeysList(await fse.readFile(file, 'utf8'), this.rootPublicKey)
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
						this.logger.error(`Ignoring invalid signing keys list at ${file}`, error)
					}
				}
			}),
		)

		const newest = newestSigningKeysList([this.#unsaved, ...lists])
		if (!newest) throw new Error('No valid approved signing keys list found')
		return newest
	}

	// Fetch the list from every source and save it if one is newer than the device's copy. Returns the
	// newest list. Concurrent calls share one refresh.
	refresh() {
		this.#refreshing ??= this.#refresh().finally(() => (this.#refreshing = undefined))
		return this.#refreshing
	}

	async #refresh() {
		const fetched = await Promise.all(
			this.#signingKeysUrls.map(async (url) => {
				try {
					const response = await fetch(url, {
						headers: {'User-Agent': `umbrelOS ${this.#umbreld.version}`},
						signal: AbortSignal.timeout(30_000),
					})
					if (!response.ok) throw new Error(`HTTP ${response.status}`)
					return verifySigningKeysList(await readText(response), this.rootPublicKey)
				} catch (error) {
					this.logger.error(`Failed to fetch signing keys from ${url}`, error)
				}
			}),
		)

		return this.#keepNewest(fetched)
	}

	// Keep a list signed by the root key, like one a release carries, if it's newer than the device's.
	// Returns the newest list.
	offer(list: SigningKeysList) {
		return this.#keepNewest([list])
	}

	// Save the newest of the lists and the device's own, one save at a time so an older list can't overwrite
	// a newer one. It's saved whenever the saved copy isn't it, like after updating to a release that
	// bundles a newer list, so going back to an older release can't forget it. Returns the newest list.
	#keepNewest(lists: (SigningKeysList | undefined)[]) {
		const saving = this.#saving.then(async () => {
			const current = await this.get()
			const newest = newestSigningKeysList([current, ...lists])!
			if (newest !== current) {
				this.logger.log(`Approved signing keys updated to the list from ${newest.date.toISOString()}`)
			}
			const saved = await fse.readFile(this.#savedSigningKeysPath, 'utf8').catch(() => undefined)
			if (saved === newest.text) {
				this.#unsaved = undefined
				return newest
			}
			try {
				await writeFileDurably(this.#savedSigningKeysPath, `${this.#savedSigningKeysPath}.tmp`, newest.text)
				this.#unsaved = undefined
			} catch (error) {
				this.#unsaved = newest
				this.logger.error('Failed to save signing keys', error)
			}
			return newest
		})
		this.#saving = saving.catch(() => {})
		return saving
	}
}
