import bcrypt from 'bcryptjs'
import fse from 'fs-extra'
import {$} from 'execa'

import type Umbreld from '../index.js'

import * as totp from './utilities/totp.js'

export default class User {
	#store: Umbreld['store']
	#umbreld: Umbreld

	constructor(umbreld: Umbreld) {
		this.#store = umbreld.store
		this.#umbreld = umbreld
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

	// Set the users password
	async setPassword(password: string) {
		// Hash the password with the current recommended default
		// of 10 bcrypt rounds
		// https://security.stackexchange.com/a/83382
		const saltRounds = 10
		const hashedPassword = await bcrypt.hash(password, saltRounds)

		return this.setHashedPassword(hashedPassword)
	}

	async setSystemPassword(password: string) {
		try {
			const userFile = await fse.readFile('/etc/passwd', 'utf8')
			const hasUmbrelSystemUser = userFile.split('\n').some((line) => line.startsWith('umbrel:'))

			// Only attempt this if there's an umbrel user
			if (hasUmbrelSystemUser) {
				await $({input: `umbrel:${password}`})`chpasswd`
			}
		} catch (error) {
			// If the system password update fails, log it but continue
			this.#umbreld.logger.error(`Failed to update system password: ${(error as Error).message}`)
		}
	}

	// Directly sets the hashed password value (only exposed for data migration)
	async setHashedPassword(hashedPassword: string) {
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
}
