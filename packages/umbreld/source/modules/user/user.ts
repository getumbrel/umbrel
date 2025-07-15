import bcrypt from 'bcryptjs'
import fse from 'fs-extra'
import {$} from 'execa'

import type Umbreld from '../../index.js'

import * as totp from '../utilities/totp.js'

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
		// As of 2023: https://wiki.php.net/rfc/bcrypt_cost_2023
		const saltRounds = 12
		// For historical reasons, bcrypt.js@2 produces $2a$ hashes unaffected
		// by the OpenBSD bug that led to incrementing the version to $2b$. When
		// verifying, it handles $2a$, $2b$ and $2y$ like OpenBSD $2b$.
		const hashedPassword = (await bcrypt.hash(password, saltRounds)).replace(/^\$2a\$/, '$2b$')
		const success = await this.setHashedPassword(hashedPassword)
		if (success) {
			// Also synchronize Linux system password
			// It's async but we don't need to wait for it to complete
			this.syncSystemPassword()
		}
		return success
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
		return this.#store.set('user.hashedPassword', hashedPassword)
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
		await this.#umbreld.store.set('widgets', ['umbrel:files-favorites', 'umbrel:storage', 'umbrel:system-stats'])
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

	// Set language preference
	async setLanguage(language: string) {
		return this.#store.set('user.language', language)
	}

	// Set temperature unit preference
	async setTemperatureUnit(temperatureUnit: string) {
		return this.#store.set('user.temperatureUnit', temperatureUnit)
	}
}
