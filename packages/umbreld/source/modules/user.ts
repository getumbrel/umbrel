import bcrypt from 'bcryptjs'

import type Umbreld from '../index.js'

import * as totp from './utilities/totp.js'
import {Widget} from './apps/schema.js'

export default class User {
	#store: Umbreld['store']

	constructor(umbreld: Umbreld) {
		this.#store = umbreld.store
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
		return this.#store.set('user.name', name)
	}

	// Set the users wallpaper
	async setWallpaper(wallpaper: string) {
		return this.#store.set('user.wallpaper', wallpaper)
	}

	// Set the users wallpaper
	async setWidgets(widgets: Widget[]) {
		return this.#store.set('user.widgets', widgets)
	}

	// Set the users password
	async setPassword(password: string) {
		// Hash the password with the current recommended default
		// of 10 bcrypt rounds
		// https://security.stackexchange.com/a/83382
		const saltRounds = 10
		const hashedPassword = await bcrypt.hash(password, saltRounds)

		return this.#store.set('user.hashedPassword', hashedPassword)
	}

	// Register a new user
	async register(name: string, password: string) {
		// Check the user hasn't already signed up
		if (await this.exists()) {
			throw new Error('Attempted to register when user is already registered')
		}

		// Save the user
		await this.setName(name)
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
		return this.#store.set('user.totpUri', totpUri)
	}

	// Disable 2FA
	async disable2fa() {
		return this.#store.delete('user.totpUri')
	}

	async setTorEnabled(torEnabled: boolean) {
		return this.#store.set('user.torEnabled', torEnabled)
	}
}
