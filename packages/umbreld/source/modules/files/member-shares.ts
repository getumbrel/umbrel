import fse from 'fs-extra'

import type Umbreld from '../../index.js'
import {OWNER_USER_ID} from '../user/constants.js'
import type {FileChangeEvent} from './watcher.js'
import AsyncBurstCache from '../utilities/async-burst-cache.js'
import AppDirectoryMonitor from './app-directory-monitor.js'

const WATCHER_SNAPSHOT_TTL_MS = 1000

// A path the owner has shared with member accounts. Paths are always in the
// owner namespace (/Home, /Apps, /External, /Network) and access covers the
// entire subtree below them. `sharedWith` is either the literal 'all', which also
// covers members created in the future, or an explicit list of member ids.
// Shares grant read-write access subject to the usual system rules such as
// protected and read-only paths.
export type MemberShare = {
	path: string
	sharedWith: 'all' | string[]
}

export default class MemberShares {
	#umbreld: Umbreld
	logger: Umbreld['logger']
	#removeFileChangeListener?: () => void
	#appDirectories: AppDirectoryMonitor
	#watcherShares: AsyncBurstCache<MemberShare[]>

	constructor(umbreld: Umbreld) {
		this.#umbreld = umbreld
		this.#watcherShares = new AsyncBurstCache(() => this.list(), WATCHER_SNAPSHOT_TTL_MS)
		const {name} = this.constructor
		this.logger = umbreld.logger.createChildLogger(`files:${name.toLocaleLowerCase()}`)
		this.#appDirectories = new AppDirectoryMonitor({
			listPaths: async () => (await this.list()).map(({path}) => path),
			systemPath: (path) => umbreld.files.virtualToSystemPathUnsafe(path),
			onDelete: (path) => this.removeWithin(path),
			logger: this.logger,
		})
	}

	// Remove shares when the shared directory is deleted, trashed or renamed so
	// a directory recreated at the same path later isn't silently re-shared.
	// Apps use targeted directory identity checks. External and network
	// paths aren't watched, so UI-initiated deletes handle their share removal in
	// files.ts (mirrors the samba module).
	async #handleFileChange(event: FileChangeEvent) {
		if (event.type !== 'delete') return
		const virtualDeletedPath = this.#umbreld.files.systemToVirtualPath(event.path)
		const shares = await this.#watcherShares.get()
		if (!shares.some((share) => share.path === virtualDeletedPath || share.path.startsWith(`${virtualDeletedPath}/`))) {
			return
		}
		await this.removeWithin(virtualDeletedPath)
	}

	// Attach listener and remove stale shares
	async start() {
		this.#removeFileChangeListener = this.#umbreld.eventBus.on(
			'files:watcher:change',
			this.#handleFileChange.bind(this),
		)

		// The watcher can miss deletions (while umbreld is stopped, or during a
		// watcher outage), leaving stale records that would silently re-grant
		// access to a directory recreated at the same path. Sweep Home and Apps
		// paths on startup. External and Network shares legitimately point at
		// nothing while the device is detached, like samba shares they stay and
		// UI-initiated deletes clean them up in files.ts.
		await this.#removeStaleShares().catch((error) => this.logger.error('Failed to remove stale shares', error))
		await this.#appDirectories.start()
	}

	async #removeStaleShares() {
		const shares = await this.list()
		for (const share of shares) {
			if (
				share.path !== '/Home' &&
				!share.path.startsWith('/Home/') &&
				share.path !== '/Apps' &&
				!share.path.startsWith('/Apps/')
			) {
				continue
			}
			const exists = await this.#umbreld.files
				.virtualToSystemPath(share.path, OWNER_USER_ID)
				.then((systemPath) => fse.pathExists(systemPath))
				.catch(() => false)
			if (!exists) {
				this.logger.log(`Removing stale share '${share.path}'`)
				await this.remove(share.path)
			}
		}
	}

	// Remove listener
	async stop() {
		this.#removeFileChangeListener?.()
		await this.#appDirectories.stop()
	}

	// Notify listeners (e.g. member UIs and Cloud destination guards) which
	// accounts a share change affects. Pass every sharedWith list the change
	// touched (e.g. old and new grantees of an upsert) so nobody who lost access
	// misses the event. Callers await this so revocation does not return while a
	// Cloud transfer is still using the revoked destination.
	#emitChange(...sharedWithLists: ('all' | string[])[]) {
		const sharedWith = sharedWithLists.includes('all')
			? 'all'
			: [...new Set(sharedWithLists.filter((list): list is string[] => list !== 'all').flat())]
		return this.#umbreld.eventBus.emit('files:member-shares:change', {sharedWith})
	}

	// List all shares (owner management view)
	async list(): Promise<MemberShare[]> {
		const shares = (await this.#umbreld.store.get('files.memberShares')) ?? []
		return shares.map(({path, sharedWith}) => ({path, sharedWith}))
	}

	// List the file shares that apply to a given member. App sharing is handled
	// separately by the app proxy and does not grant raw /Apps data access.
	// Cached briefly since this runs on hot paths (per-file during directory
	// listings, per-event on the watcher stream) and every uncached call costs
	// two store file reads. The in-flight promise is cached so a burst of
	// concurrent calls (e.g. a large listing) shares a single read. Mutations in
	// this module clear the cache.
	#listForUserCache = new Map<string, {promise: Promise<MemberShare[]>; expires: number}>()
	#listForUserCacheTtl = 1000 // 1 second

	// Drop the cached per-user share lists so changes apply immediately
	invalidateCache() {
		this.#listForUserCache.clear()
		this.#watcherShares.clear()
	}

	async listForUser(userId: string): Promise<MemberShare[]> {
		if (userId === OWNER_USER_ID) return []
		const cached = this.#listForUserCache.get(userId)
		if (cached && cached.expires > Date.now()) return cached.promise
		const promise = this.#listForUser(userId)
		this.#listForUserCache.set(userId, {promise, expires: Date.now() + this.#listForUserCacheTtl})
		// Don't cache failures
		promise.catch(() => {
			if (this.#listForUserCache.get(userId)?.promise === promise) this.#listForUserCache.delete(userId)
		})
		return promise
	}

	async #listForUser(userId: string): Promise<MemberShare[]> {
		const shares = await this.list()
		return shares.filter((share) => share.sharedWith === 'all' || share.sharedWith.includes(userId))
	}

	// The deepest share granting `userId` access to `virtualPath`, or undefined
	// when nothing grants access. Prefix matching is done on the normalized
	// virtual path so traversal can't widen a grant, and the caller enforces
	// physical containment against the returned share's root.
	async shareGrantFor(virtualPath: string, userId: string): Promise<MemberShare | undefined> {
		if (userId === OWNER_USER_ID) return undefined
		// Normalizing via the pure resolver's rules: resolve traversal then trim
		const path = this.#umbreld.files.normalizeVirtualPath(virtualPath)
		const shares = await this.listForUser(userId)
		const matching = shares.filter((share) => path === share.path || path.startsWith(`${share.path}/`))
		if (matching.length === 0) return undefined
		return matching.sort((a, b) => b.path.length - a.path.length)[0]
	}

	// The names of the immediate children of `virtualPath` a member may see
	// while navigating down toward the paths shared with them (e.g. with
	// /Home/Photos/holiday shared, /Home lists just 'Photos'). Returns undefined
	// when the path isn't an ancestor of any of their shares.
	async visibleChildrenFor(virtualPath: string, userId: string): Promise<string[] | undefined> {
		if (userId === OWNER_USER_ID) return undefined
		const path = this.#umbreld.files.normalizeVirtualPath(virtualPath)
		if (path === '/') return undefined
		const prefix = `${path}/`
		const children = new Set<string>()
		for (const share of await this.listForUser(userId)) {
			if (share.path.startsWith(prefix)) children.add(share.path.slice(prefix.length).split('/')[0])
		}
		if (children.size === 0) return undefined
		return [...children]
	}

	// Share a path with all members or a specific list of members. Upserts, so
	// sharing an already shared path updates who it's shared with.
	async add(virtualPath: string, sharedWith: 'all' | string[]): Promise<MemberShare> {
		const path = this.#umbreld.files.normalizeVirtualPath(virtualPath)

		// Only paths in the owner's namespace can be shared: their home, app data
		// (at least a specific app, not the /Apps root), or the complete external
		// or network storage category. Category-wide storage grants deliberately
		// cover current and future devices; individual devices and directories
		// below them are not independently shareable.
		const segments = path.split('/').filter(Boolean)
		const base = segments[0]
		if (base === 'Home') {
			// '/Home' itself or anything below it is fine
		} else if (base === 'Apps') {
			if (segments.length < 2) throw new Error('[invalid-base] Share an app or a directory inside it')
		} else if (base === 'External' || base === 'Network') {
			if (segments.length !== 1) throw new Error('[invalid-base] Share all storage in this category')
			if (sharedWith === 'all') throw new Error('[invalid-users] Storage access must target specific users')
		} else {
			throw new Error('[invalid-base] Only Home, Apps, External and Network paths can be shared')
		}

		// The path must exist and be a directory. Resolved as the owner so the
		// usual symlink containment applies.
		const systemPath = await this.#umbreld.files.virtualToSystemPath(path, OWNER_USER_ID)
		const stats = await fse.stat(systemPath).catch(() => {
			throw new Error('[does-not-exist]')
		})
		if (!stats.isDirectory()) throw new Error('[not-a-directory] Only directories can be shared')

		// Validate the member ids exist
		if (sharedWith !== 'all') {
			const members = await this.#umbreld.user.listMembers()
			const memberIds = new Set(members.map((member) => member.id))
			const uniqueIds = [...new Set(sharedWith)]
			if (uniqueIds.length === 0) throw new Error('[no-users] Share with all users or at least one user')
			for (const id of uniqueIds) {
				if (!memberIds.has(id)) throw new Error(`[unknown-user] '${id}'`)
			}
			sharedWith = uniqueIds
		}

		const share: MemberShare = {path, sharedWith}
		let previousSharedWith: 'all' | string[] = []
		await this.#umbreld.store.getWriteLock(async ({get, set}) => {
			const shares = (await get('files.memberShares')) ?? []
			previousSharedWith = shares.find((existingShare) => existingShare.path === path)?.sharedWith ?? []
			const otherShares = shares.filter((existingShare) => existingShare.path !== path)
			await set('files.memberShares', [...otherShares, share])
		})
		this.invalidateCache()
		await this.#emitChange(previousSharedWith, sharedWith)
		this.#appDirectories.forget(path)
		await this.#appDirectories.refresh()

		this.logger.log(`Shared '${path}' with ${sharedWith === 'all' ? 'all users' : sharedWith.join(', ')}`)
		return share
	}

	// Stop sharing a path
	async remove(virtualPath: string): Promise<boolean> {
		const path = this.#umbreld.files.normalizeVirtualPath(virtualPath)
		let removed = false
		let removedSharedWith: 'all' | string[] = []
		await this.#umbreld.store.getWriteLock(async ({get, set}) => {
			const shares = (await get('files.memberShares')) ?? []
			removedSharedWith = shares.find((share) => share.path === path)?.sharedWith ?? []
			const remainingShares = shares.filter((share) => share.path !== path)
			removed = remainingShares.length !== shares.length
			if (removed) await set('files.memberShares', remainingShares)
		})
		this.invalidateCache()
		if (removed) {
			await this.#emitChange(removedSharedWith)
			this.logger.log(`Stopped sharing '${path}'`)
		}
		return removed
	}

	// Stop sharing a path and anything below it. Filesystem operations call this
	// synchronously after moving or deleting a path so access cannot return if a
	// different directory is later created at the same location. The watcher and
	// startup sweep remain fallbacks for changes made outside the files API.
	async removeWithin(virtualPath: string): Promise<boolean> {
		const path = this.#umbreld.files.normalizeVirtualPath(virtualPath)
		let removedShares: Pick<MemberShare, 'path' | 'sharedWith'>[] = []
		await this.#umbreld.store.getWriteLock(async ({get, set}) => {
			const shares = (await get('files.memberShares')) ?? []
			removedShares = shares.filter((share) => share.path === path || share.path.startsWith(`${path}/`))
			if (removedShares.length === 0) return
			await set(
				'files.memberShares',
				shares.filter((share) => !removedShares.includes(share)),
			)
		})
		if (removedShares.length === 0) return false

		this.invalidateCache()
		await this.#emitChange(...removedShares.map((share) => share.sharedWith))
		for (const share of removedShares) this.logger.log(`Stopped sharing '${share.path}'`)
		return true
	}

	// Remove a deleted member from any explicit share lists (called on user
	// deletion). Shares left with nobody are removed entirely, including 'all'
	// shares once no members remain — otherwise they'd linger invisibly and
	// silently grant access to the next member created.
	async removeUserFromShares(userId: string) {
		const hasMembers = (await this.#umbreld.user.listMembers()).length > 0
		await this.#umbreld.store.getWriteLock(async ({get, set}) => {
			const shares = (await get('files.memberShares')) ?? []
			const updatedShares = shares
				.map((share) => {
					if (share.sharedWith === 'all') return share
					return {...share, sharedWith: share.sharedWith.filter((id) => id !== userId)}
				})
				.filter((share) => (share.sharedWith === 'all' ? hasMembers : share.sharedWith.length > 0))
			await set('files.memberShares', updatedShares)
		})
		this.invalidateCache()
		await this.#emitChange([userId])
	}
}
