import bcrypt from 'bcryptjs'
import fse from 'fs-extra'
import {$} from 'execa'

import type Umbreld from '../../index.ts'
import type {ViewPreferences} from '../files/files.ts'

import * as totp from '../utilities/totp.ts'
import {removeAccountAvatarDirectory} from './avatar.ts'
import {OWNER_USER_ID} from './constants.ts'

export type Member = {
	id: string
	name: string
	hashedPassword: string
	// Samba uses NT password authentication, so it needs a separate plaintext
	// secret that can be reapplied to the local passdb after an OS update. The
	// presence of this field means Samba access is enabled for the member.
	sambaPassword?: string
	avatarHash?: string
	// Per-member profile settings, mirroring the owner's user object
	totpUri?: string
	wallpaper?: string
	language: string
	temperatureUnit?: string
	viewPreferences?: Partial<ViewPreferences>
	favorites?: string[]
	// Enabled desktop widgets. Undefined means the member has never changed
	// them and gets the defaults at read time.
	widgets?: string[]
}

export type DeletedMember = {
	id: string
	deleted: true
	cleanupComplete?: true
}

export type MemberRecord = Member | DeletedMember

// Widgets every account starts with. The owner is seeded at registration,
// members get these at read time until they change their widgets.
export const DEFAULT_WIDGETS = ['umbrel:files-favorites', 'umbrel:storage', 'umbrel:system-stats']

export type Account = {
	userId: string
	name: string
	wallpaper?: string
	language: string
	avatarHash?: string
}

export type AccountLoginValidation =
	| {valid: true; sessionIssuanceRevision: number}
	| {valid: false; reason: 'incorrect-password' | 'missing-totp' | 'incorrect-totp'}

const isActiveMember = (member: MemberRecord): member is Member => !('deleted' in member)
const isDeletedMember = (member: MemberRecord): member is DeletedMember => 'deleted' in member

export default class User {
	#store: Umbreld['store']
	logger: Umbreld['logger']
	#umbreld: Umbreld
	constructor(umbreld: Umbreld) {
		this.#store = umbreld.store
		const {name} = this.constructor
		this.logger = umbreld.logger.createChildLogger(name.toLowerCase())
		this.#umbreld = umbreld
	}

	async start() {
		this.logger.log('Starting user')
	}

	async stop() {
		this.logger.log('Stopping user')
	}

	// Get the user object from the store
	async get() {
		return this.#store.get('user')
	}

	// Check if a user exists
	async exists() {
		const user = await this.get()
		return user !== undefined
	}

	// Set the users name
	async setName(name: string) {
		if (await this.#umbreld.hardware.raid.hasConfigStore()) {
			await this.#umbreld.hardware.raid.configStore.set('user.name', name)
		}
		return await this.#store.set('user.name', name)
	}

	// Set the users wallpaper
	async setWallpaper(wallpaper: string) {
		return this.#store.set('user.wallpaper', wallpaper)
	}

	// Hash a password for storage
	async #hashPassword(password: string) {
		// Hash the password with the current recommended default
		// As of 2023: https://wiki.php.net/rfc/bcrypt_cost_2023
		const saltRounds = 12
		// For historical reasons, bcrypt.js@2 produces $2a$ hashes unaffected
		// by the OpenBSD bug that led to incrementing the version to $2b$. When
		// verifying, it handles $2a$, $2b$ and $2y$ like OpenBSD $2b$.
		return (await bcrypt.hash(password, saltRounds)).replace(/^\$2a\$/, '$2b$')
	}

	// Set the users password
	async setPassword(password: string) {
		return this.#withAccountCredentialChange(OWNER_USER_ID, async () => {
			const hashedPassword = await this.#hashPassword(password)
			const success = await this.#setOwnerHashedPassword(hashedPassword)
			if (success) {
				// Also synchronize Linux system password
				// It's async but we don't need to wait for it to complete
				this.syncSystemPassword()
			}
			return success
		})
	}

	async syncSystemPassword() {
		try {
			const userFile = await fse.readFile('/etc/passwd', 'utf8')
			const hasUmbrelSystemUser = userFile.split('\n').some((line) => line.startsWith('umbrel:'))
			const hashedPassword = (await this.#store.get('user.hashedPassword')) || ''

			// Only attempt this if there's an umbrel user and a password has been set
			if (hasUmbrelSystemUser && hashedPassword.length > 0) {
				// Sanity-check that the system supports bcrypt. We assume that a modern
				// distro that supports bcrypt in any capacity can handle $2b$ hashes and
				// that we are not coming into contact with actually bugged $2a$ hashes.
				const {stdout} = await $`mkpasswd --method help`
				const supportsBcrypt = /^bcrypt\s/m.test(stdout)
				if (supportsBcrypt) {
					const bcryptRegex = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/
					if (bcryptRegex.test(hashedPassword)) {
						const systemPassword = hashedPassword.replace(/^\$2[ay]\$/, '$2b$')
						await $({input: `umbrel:${systemPassword}`})`chpasswd --encrypted`
						this.logger.log(`Synced system password`)
					} else {
						this.logger.error(`Failed to update system password: invalid password hash`)
					}
				} else {
					this.logger.error(`Failed to update system password: bcrypt not supported`)
				}
			}
		} catch (error) {
			// If the system password update fails, log it but continue
			this.logger.error(`Failed to update system password`, error)
		}
	}

	// Directly sets the hashed password value (only exposed for data migration)
	async setHashedPassword(hashedPassword: string) {
		return this.#withAccountCredentialChange(OWNER_USER_ID, () => this.#setOwnerHashedPassword(hashedPassword))
	}

	async #setOwnerHashedPassword(hashedPassword: string) {
		if (await this.#umbreld.hardware.raid.hasConfigStore()) {
			await this.#umbreld.hardware.raid.configStore.set('user.hashedPassword', hashedPassword)
		}
		return this.#store.set('user.hashedPassword', hashedPassword)
	}

	async #withAccountCredentialChange<T>(accountId: string, operation: () => Promise<T>) {
		const finish = this.#umbreld.auth.beginAccountCredentialChange(accountId)
		try {
			return await operation()
		} finally {
			finish()
		}
	}

	// Register a new user
	async register(name: string, password: string, language: string) {
		// Check the user hasn't already signed up
		if (await this.exists()) {
			throw new Error('Attempted to register when user is already registered')
		}

		// Save the user
		await this.setName(name)
		await this.setLanguage(language)
		// We can do this a cleaner way if we refactor widgets into a proper module
		await this.#umbreld.store.set('widgets', DEFAULT_WIDGETS)
		// Drives the tips on the homescreen until the user dismisses
		await this.#umbreld.notifications.add('onboarding-complete')
		return this.setPassword(password)
	}

	// Validate a password against the stored hash
	async validatePassword(password: string) {
		// Get hashed password
		const hashedPassword = await this.#store.get('user.hashedPassword')

		// Validate credentials
		const validPassword = hashedPassword && (await bcrypt.compare(password, hashedPassword))

		return validPassword
	}

	// Check if 2FA is enabled
	async is2faEnabled() {
		return Boolean(await this.#store.get('user.totpUri'))
	}

	// Validate a 2FA token against the stored secret
	async validate2faToken(token: string) {
		const totpUri = await this.#store.get('user.totpUri')
		return totp.verify(totpUri!, token)
	}

	// Enable 2FA
	async enable2fa(totpUri: string) {
		return this.#withAccountCredentialChange(OWNER_USER_ID, () => this.#store.set('user.totpUri', totpUri))
	}

	// Disable 2FA
	async disable2fa() {
		return this.#withAccountCredentialChange(OWNER_USER_ID, () => this.#store.delete('user.totpUri'))
	}

	// Set language preference
	async setLanguage(language: string) {
		if (await this.#umbreld.hardware.raid.hasConfigStore()) {
			await this.#umbreld.hardware.raid.configStore.set('user.language', language)
		}
		return this.#store.set('user.language', language)
	}

	// Set temperature unit preference
	async setTemperatureUnit(temperatureUnit: string) {
		return this.#store.set('user.temperatureUnit', temperatureUnit)
	}

	// ── Members ─────────────────────────────────────────────────────────────
	// Member accounts are additional users created by the owner. The owner is
	// always user id '0' and lives in the top level 'user' store key, members
	// get a slug id derived from their name and live in the 'members' array.

	// List all member accounts
	async listMembers(): Promise<Member[]> {
		return ((await this.#store.get('members')) ?? []).filter(isActiveMember)
	}

	// Deleted member ids are permanent security identities. Modules that restore
	// account-owned background work use this before startup cleanup runs so a
	// tombstoned account cannot briefly become active again after a restart.
	async listDeletedMemberIds(): Promise<string[]> {
		return ((await this.#store.get('members')) ?? []).filter(isDeletedMember).map(({id}) => id)
	}

	// Get a member account by user id
	async getMember(userId: string): Promise<Member | undefined> {
		const members = await this.listMembers()
		return members.find((member) => member.id === userId)
	}

	// List all accounts on this device (no password hashes)
	async listAccounts(): Promise<Account[]> {
		const owner = await this.get()
		const members = await this.listMembers()
		const ownerLanguage = owner?.language ?? 'en'
		return [
			{
				userId: OWNER_USER_ID,
				name: owner?.name ?? '',
				wallpaper: owner?.wallpaper,
				language: ownerLanguage,
				...(owner?.avatarHash ? {avatarHash: owner.avatarHash} : {}),
			},
			...members.map((member) => ({
				userId: member.id,
				name: member.name,
				wallpaper: member.wallpaper,
				language: member.language,
				...(member.avatarHash ? {avatarHash: member.avatarHash} : {}),
			})),
		]
	}

	// Create a new member account with its own home directory
	async createUser(name: string, password: string): Promise<{userId: string; name: string}> {
		if (!(await this.exists())) throw new Error('Cannot create users before the owner is registered')

		const hashedPassword = await this.#hashPassword(password)

		// Check the name and derive the id inside the write lock so concurrent
		// creates can't both pass the checks and claim the same slug
		let member: Member | undefined
		await this.#store.getWriteLock(async ({get, set}) => {
			// Check the name isn't already taken by the owner or another member
			const owner = await get('user')
			const memberRecords = (await get('members')) ?? []
			const members = memberRecords.filter(isActiveMember)
			const nameTaken = owner?.name === name || members.some((member) => member.name === name)
			if (nameTaken) throw new Error('A user with this name already exists')

			// Derive a human-readable, immutable user id slug from the name. It becomes
			// the member's path component (/Users/<id>), so it must be a safe, stable,
			// unique directory name. The display name stays separate and can change; the
			// slug never does. Lowercase, strip to a-z, append -n on collision, then
			// capitalise the first letter. e.g. "Alice" -> "Alice", a second -> "Alice-2".
			const base = name.toLowerCase().replace(/[^a-z]/g, '') || 'user'
			const takenIds = new Set([OWNER_USER_ID, ...memberRecords.map((member) => member.id)])
			const capitalise = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)
			let id = capitalise(base)
			for (let suffix = 2; takenIds.has(id); suffix++) id = capitalise(`${base}-${suffix}`)

			member = {id, name, hashedPassword, language: owner?.language ?? 'en'}
			await set('members', [...memberRecords, member])
		})
		if (!member) throw new Error('User creation failed')

		// Create the user's home directory with the default skeleton
		await this.#umbreld.files.createMemberDirectories(member.id)

		// Drives the member's welcome desktop until they dismiss it; scoped so
		// only this account sees it
		await this.#umbreld.notifications.addForAccount(member.id, 'onboarding-complete')

		this.logger.log(`Created user ${name} (${member.id})`)
		return {userId: member.id, name: member.name}
	}

	// Delete a member account. Marking it deleted is a single durable state
	// transition: authentication stops accepting it immediately, its id remains
	// permanently reserved, and cleanup can safely resume after any failure.
	async deleteUser(userId: string): Promise<boolean> {
		if (userId === OWNER_USER_ID) throw new Error('The owner account cannot be deleted')

		let found = false
		await this.#store.getWriteLock(async ({get, set}) => {
			const memberRecords = (await get('members')) ?? []
			const record = memberRecords.find((member) => member.id === userId)
			if (!record) return
			found = true
			if (isDeletedMember(record)) return
			await set(
				'members',
				memberRecords.map((member) => (member.id === userId ? {id: userId, deleted: true as const} : member)),
			)
		})
		if (!found) throw new Error('User not found')

		await this.#finishDeletion(userId)
		return true
	}

	// Resume deletion side effects left incomplete by a crash or I/O failure.
	// Called once all dependent modules have started.
	async finishPendingDeletions() {
		const pending = ((await this.#store.get('members')) ?? []).filter(
			(member): member is DeletedMember => isDeletedMember(member) && !member.cleanupComplete,
		)
		for (const member of pending) {
			await this.#finishDeletion(member.id).catch((error) => {
				this.logger.error(`Failed to finish deleting user ${member.id}; will retry on next start`, error)
			})
		}
	}

	async #finishDeletion(userId: string) {
		// Revoke sessions and remove private Cloud state before deleting the
		// private Home. Cloud data already downloaded to
		// shared external/network storage is deliberately left behind as ordinary
		// files. Attempt every independent cleanup even if one fails so neither an
		// authenticated session nor a background transfer remains live because another
		// subsystem needs a retry.
		const privateServiceCleanup = await Promise.allSettled([
			this.#umbreld.auth.revokeAllForAccount(userId),
			this.#umbreld.files.cloud.removeUser(userId),
			this.#umbreld.files.samba.removeUser(userId),
		])
		const cleanupFailures = privateServiceCleanup.filter(
			(result): result is PromiseRejectedResult => result.status === 'rejected',
		)
		if (cleanupFailures.length === 1) throw cleanupFailures[0].reason
		if (cleanupFailures.length > 1) {
			throw new AggregateError(
				cleanupFailures.map(({reason}) => reason),
				`Failed to remove private services for ${userId}`,
			)
		}

		// Remove Photos source state and any legacy private-layout data before
		// Files removes the member's Home and its current backup files.
		await this.#umbreld.photos.deleteAccount(userId)

		// Delete the user's private Home, trash, and associated metadata.
		await this.#umbreld.files.deleteMemberDirectories(userId)

		// These operations are independent and idempotent. Attempt all of them so
		// one unavailable subsystem does not prevent the others from making progress.
		const accountDataCleanup = await Promise.allSettled([
			this.#umbreld.files.memberShares.removeUserFromShares(userId),
			this.#umbreld.apps.removeUserFromMemberShares(userId),
			removeAccountAvatarDirectory(this.#umbreld, userId),
		])
		const accountDataCleanupFailures = accountDataCleanup.filter(
			(result): result is PromiseRejectedResult => result.status === 'rejected',
		)
		if (accountDataCleanupFailures.length === 1) throw accountDataCleanupFailures[0].reason
		if (accountDataCleanupFailures.length > 1) {
			throw new AggregateError(
				accountDataCleanupFailures.map(({reason}) => reason),
				`Failed to remove account data for ${userId}`,
			)
		}

		await this.#store.getWriteLock(async ({get, set}) => {
			const memberRecords = (await get('members')) ?? []
			const record = memberRecords.find((member) => member.id === userId)
			if (!record || !isDeletedMember(record)) return
			await set(
				'members',
				memberRecords.map((member) =>
					member.id === userId ? {id: userId, deleted: true as const, cleanupComplete: true as const} : member,
				),
			)
		})

		this.logger.log(`Deleted user ${userId}`)
	}

	// Validate a password against any account's stored hash
	async validateAccountPassword(userId: string, password: string): Promise<boolean> {
		let hashedPassword: string | undefined
		if (userId === OWNER_USER_ID) {
			hashedPassword = await this.#store.get('user.hashedPassword')
		} else {
			const member = await this.getMember(userId)
			hashedPassword = member?.hashedPassword
		}
		return Boolean(hashedPassword && (await bcrypt.compare(password, hashedPassword)))
	}

	// Validate one coherent password/MFA snapshot and bind the result to the
	// current session-issuance revision. Auth rechecks that revision immediately
	// before committing the session, so a concurrent credential change cannot
	// turn a stale verification into a new login.
	async validateAccountLogin(userId: string, password: string, totpToken?: string): Promise<AccountLoginValidation> {
		const sessionIssuanceRevision = this.#umbreld.auth.sessionIssuanceRevision(userId)
		const account = userId === OWNER_USER_ID ? await this.get() : await this.getMember(userId)

		if (!account?.hashedPassword || !(await bcrypt.compare(password, account.hashedPassword))) {
			return {valid: false, reason: 'incorrect-password'}
		}
		if (account.totpUri) {
			if (!totpToken) return {valid: false, reason: 'missing-totp'}
			if (!totp.verify(account.totpUri, totpToken)) return {valid: false, reason: 'incorrect-totp'}
		}

		return {valid: true, sessionIssuanceRevision}
	}

	// ── Account scoped settings ─────────────────────────────────────────────
	// These operate on either the owner (user id '0', stored in the top level
	// 'user' object) or a member (stored in the 'members' array), so endpoints
	// members are allowed to use can always be scoped to their own account.

	// Update a member's record in the store. Throws if the member doesn't exist.
	async #updateMember(userId: string, updates: Partial<Omit<Member, 'id'>>) {
		let found = false
		await this.#store.getWriteLock(async ({get, set}) => {
			const memberRecords = (await get('members')) ?? []
			const updatedMembers = memberRecords.map((member) => {
				if (member.id !== userId || !isActiveMember(member)) return member
				found = true
				return {...member, ...updates}
			})
			if (found) await set('members', updatedMembers)
		})
		if (!found) throw new Error('User not found')
		return true
	}

	async getAccountAvatarHash(userId: string) {
		if (userId === OWNER_USER_ID) {
			const owner = await this.get()
			if (!owner) throw new Error('User not found')
			return owner.avatarHash
		}

		const member = await this.getMember(userId)
		if (!member) throw new Error('User not found')
		return member.avatarHash
	}

	async setAccountAvatarHash(userId: string, avatarHash: string) {
		if (!/^[a-f0-9]{64}$/.test(avatarHash)) throw new Error('Invalid avatar hash')
		return this.#updateAccountAvatarHash(userId, avatarHash)
	}

	async removeAccountAvatarHash(userId: string) {
		return this.#updateAccountAvatarHash(userId)
	}

	// Commit avatar metadata under the same store lock used by the rest of the
	// account settings. The member is revalidated here because it may have been
	// tombstoned while its upload was being processed.
	async #updateAccountAvatarHash(userId: string, avatarHash?: string) {
		let found = false
		let previousHash: string | undefined

		await this.#store.getWriteLock(async ({get, set, delete: deleteProperty}) => {
			if (userId === OWNER_USER_ID) {
				const owner = await get('user')
				if (!owner) return
				found = true
				previousHash = owner.avatarHash
				if (owner.avatarHash === avatarHash) return
				if (avatarHash) await set('user.avatarHash', avatarHash)
				else if (owner.avatarHash) await deleteProperty('user.avatarHash')
				return
			}

			const memberRecords = (await get('members')) ?? []
			let changed = false
			const updatedMembers = memberRecords.map((member) => {
				if (member.id !== userId || !isActiveMember(member)) return member
				found = true
				previousHash = member.avatarHash
				if (member.avatarHash === avatarHash) return member
				changed = true
				if (avatarHash) return {...member, avatarHash}
				const updatedMember = {...member}
				delete updatedMember.avatarHash
				return updatedMember
			})
			if (changed) await set('members', updatedMembers)
		})

		if (!found) throw new Error('User not found')
		return previousHash
	}

	// Set any account's password
	async setAccountPassword(userId: string, password: string) {
		if (userId === OWNER_USER_ID) return this.setPassword(password)
		return this.#withAccountCredentialChange(userId, async () =>
			this.#updateMember(userId, {hashedPassword: await this.#hashPassword(password)}),
		)
	}

	// Owner initiated recovery for a member who lost their credentials. Also
	// clears the member's 2FA, otherwise a lost authenticator would still lock
	// them out and the owner's only remaining recovery would be deleting the
	// account (and its files).
	async resetMemberPassword(userId: string, password: string) {
		if (userId === OWNER_USER_ID) throw new Error("The owner's password cannot be reset, use changePassword")
		return this.#withAccountCredentialChange(userId, async () =>
			this.#updateMember(userId, {
				hashedPassword: await this.#hashPassword(password),
				totpUri: undefined,
			}),
		)
	}

	// Set any account's display name. Member names must stay unique across all
	// accounts since the login screen identifies accounts by name. The id (and
	// their /Users/<id> path) is immutable and unaffected.
	async setAccountName(userId: string, name: string) {
		let found = userId === OWNER_USER_ID
		await this.#store.getWriteLock(async ({get, set}) => {
			const owner = await get('user')
			const memberRecords = (await get('members')) ?? []
			const members = memberRecords.filter(isActiveMember)
			const nameTaken =
				userId === OWNER_USER_ID
					? members.some((member) => member.name === name)
					: owner?.name === name || members.some((member) => member.id !== userId && member.name === name)
			if (nameTaken) throw new Error('A user with this name already exists')

			if (userId === OWNER_USER_ID) {
				await set('user.name', name)
				return
			}

			await set(
				'members',
				memberRecords.map((member) => {
					if (member.id !== userId || !isActiveMember(member)) return member
					found = true
					return {...member, name}
				}),
			)
		})
		if (!found) throw new Error('User not found')

		if (userId === OWNER_USER_ID) {
			// The RAID config store mirrors owner settings for recovery, while the
			// client-facing /Home Samba share is derived from the owner's display name.
			// Start both reconciliations so a failure in either one cannot prevent the
			// other from being attempted, but still reject if the rename is not fully
			// reflected in the system.
			await Promise.all([
				this.#umbreld.files.samba.applyShares(),
				(async () => {
					if (await this.#umbreld.hardware.raid.hasConfigStore()) {
						await this.#umbreld.hardware.raid.configStore.set('user.name', name)
					}
				})(),
			])
		} else if ((await this.getMember(userId))?.sambaPassword) {
			// A member's Home share also uses their display name while the login
			// username remains their immutable id.
			await this.#umbreld.files.samba.applyShares()
		}
		return true
	}

	// Set any account's wallpaper
	async setAccountWallpaper(userId: string, wallpaper: string) {
		if (userId === OWNER_USER_ID) return this.setWallpaper(wallpaper)
		return this.#updateMember(userId, {wallpaper})
	}

	// Set any account's language preference
	async setAccountLanguage(userId: string, language: string) {
		if (userId === OWNER_USER_ID) return this.setLanguage(language)
		return this.#updateMember(userId, {language})
	}

	// Each account has an explicit language. Members copy the owner's current
	// language when created, then both preferences remain independent.
	async getAccountLanguage(userId: string) {
		if (userId !== OWNER_USER_ID) {
			const member = await this.getMember(userId)
			return member?.language
		}
		const owner = await this.get()
		return owner ? (owner.language ?? 'en') : undefined
	}

	// Set any account's temperature unit preference
	async setAccountTemperatureUnit(userId: string, temperatureUnit: string) {
		if (userId === OWNER_USER_ID) return this.setTemperatureUnit(temperatureUnit)
		return this.#updateMember(userId, {temperatureUnit})
	}

	// Get any account's file browser view preferences
	async getAccountViewPreferences(userId: string): Promise<Partial<ViewPreferences> | undefined> {
		if (userId === OWNER_USER_ID) return this.#store.get('files.preferences')
		const member = await this.getMember(userId)
		return member?.viewPreferences
	}

	// Update any account's file browser view preferences
	async setAccountViewPreferences(userId: string, viewPreferences: Partial<ViewPreferences>) {
		if (userId === OWNER_USER_ID) return this.#store.set('files.preferences', viewPreferences as ViewPreferences)
		return this.#updateMember(userId, {viewPreferences})
	}

	// Get an account's file favorites. Owner data retains its established store
	// location; member data lives with the rest of that member's private state.
	async getAccountFavorites(userId: string): Promise<string[] | undefined> {
		if (userId === OWNER_USER_ID) return this.#store.get('files.favorites')
		const member = await this.getMember(userId)
		return member?.favorites
	}

	// Read every account's stored favorites from one coherent store snapshot.
	// Callers derive defaults for accounts without an explicit value.
	async getAllAccountFavorites() {
		const store = await this.#store.get()
		return [
			{userId: OWNER_USER_ID, favorites: store.files?.favorites},
			...(store.members ?? [])
				.filter(isActiveMember)
				.map((member) => ({userId: member.id, favorites: member.favorites})),
		]
	}

	// Atomically update favorites so concurrent add/remove requests cannot
	// overwrite one another. Returning undefined leaves stored state unchanged.
	async updateAccountFavorites(userId: string, update: (favorites: string[] | undefined) => string[] | undefined) {
		let found = false
		await this.#store.getWriteLock(async ({get, set}) => {
			if (userId === OWNER_USER_ID) {
				found = true
				const favorites = update(await get('files.favorites'))
				if (favorites !== undefined) await set('files.favorites', favorites)
				return
			}

			const memberRecords = (await get('members')) ?? []
			let changed = false
			const updatedMembers = memberRecords.map((member) => {
				if (member.id !== userId || !isActiveMember(member)) return member
				found = true
				const favorites = update(member.favorites)
				if (favorites === undefined) return member
				changed = true
				return {...member, favorites}
			})
			if (changed) await set('members', updatedMembers)
		})
		if (!found) throw new Error('User not found')
		return true
	}

	// Desktop widgets follow the same account boundary as favorites. Undefined
	// means the account has never changed its widgets; callers apply defaults.
	async getAccountWidgets(userId: string): Promise<string[] | undefined> {
		if (userId === OWNER_USER_ID) return this.#store.get('widgets')
		const member = await this.getMember(userId)
		return member?.widgets
	}

	// Atomically update widgets so concurrent enable/disable requests cannot
	// overwrite one another. Returning undefined leaves stored state unchanged.
	async updateAccountWidgets(userId: string, update: (widgets: string[] | undefined) => string[] | undefined) {
		let found = false
		await this.#store.getWriteLock(async ({get, set}) => {
			if (userId === OWNER_USER_ID) {
				found = true
				const widgets = update(await get('widgets'))
				if (widgets !== undefined) await set('widgets', widgets)
				return
			}

			const memberRecords = (await get('members')) ?? []
			let changed = false
			const updatedMembers = memberRecords.map((member) => {
				if (member.id !== userId || !isActiveMember(member)) return member
				found = true
				const widgets = update(member.widgets)
				if (widgets === undefined) return member
				changed = true
				return {...member, widgets}
			})
			if (changed) await set('members', updatedMembers)
		})
		if (!found) throw new Error('User not found')
		return true
	}

	// ── Account scoped 2FA ──────────────────────────────────────────────────

	// Get any account's stored TOTP URI
	async #getAccountTotpUri(userId: string): Promise<string | undefined> {
		if (userId === OWNER_USER_ID) return this.#store.get('user.totpUri')
		const member = await this.getMember(userId)
		return member?.totpUri
	}

	// Check if 2FA is enabled for any account
	async is2faEnabledForAccount(userId: string) {
		return Boolean(await this.#getAccountTotpUri(userId))
	}

	// Validate a 2FA token against any account's stored secret
	async validate2faTokenForAccount(userId: string, token: string) {
		const totpUri = await this.#getAccountTotpUri(userId)
		return Boolean(totpUri && totp.verify(totpUri, token))
	}

	// Enable 2FA for any account
	async enable2faForAccount(userId: string, totpUri: string) {
		if (userId === OWNER_USER_ID) return this.enable2fa(totpUri)
		return this.#withAccountCredentialChange(userId, () => this.#updateMember(userId, {totpUri}))
	}

	// Disable 2FA for any account
	async disable2faForAccount(userId: string) {
		if (userId === OWNER_USER_ID) return this.disable2fa()
		return this.#withAccountCredentialChange(userId, () => this.#updateMember(userId, {totpUri: undefined}))
	}
}
