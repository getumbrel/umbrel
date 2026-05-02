import crypto from 'node:crypto'
import {fileURLToPath} from 'node:url'
import {dirname, join} from 'node:path'
import fse from 'fs-extra'
import {$} from 'execa'
import pRetry from 'p-retry'
import yaml from 'js-yaml'

import type Umbreld from '../../index.js'
import type {CaddySettings} from './schema.js'
import {CaddySettingsSchema} from './schema.js'
import {buildCaddyConfig, generateCaddyfile, type CaddyRoute} from './config-builder.js'

export default class Caddy {
	#umbreld: Umbreld
	#logger: Umbreld['logger']
	#settingsFile: string
	#routes: Map<string, CaddyRoute> = new Map()
	#configPath: string
	#caddyfilePath: string
	#certsPath: string

	constructor(umbreld: Umbreld) {
		this.#umbreld = umbreld
		const {name} = this.constructor
		this.#logger = umbreld.logger.createChildLogger(name.toLowerCase())
		this.#settingsFile = `${umbreld.dataDirectory}/caddy-settings.yml`
		
		const currentFilename = fileURLToPath(import.meta.url)
		const currentDirname = dirname(currentFilename)
		
		this.#configPath = `${umbreld.dataDirectory}/caddy/config.json`
		this.#caddyfilePath = `${umbreld.dataDirectory}/caddy/Caddyfile`
		this.#certsPath = `${umbreld.dataDirectory}/caddy/certs`
	}

	async start() {
		this.#logger.log('Starting Caddy module')
		
		// Create directories
		await fse.mkdirp(`${this.#umbreld.dataDirectory}/caddy`)
		await fse.mkdirp(this.#certsPath)

		// Initialize settings
		let settings = await this.#loadSettings()
		if (settings.enabled === undefined) {
			settings = {enabled: false, domain: 'umbrel.local', httpPort: 80, httpsPort: 443, forceHttps: true}
			await this.#saveSettings(settings)
		}
		
		// Validate settings
		try {
			CaddySettingsSchema.parse(settings)
		} catch (error) {
			this.#logger.error('Invalid Caddy settings, resetting to defaults', error as Error)
			settings = {enabled: false, domain: 'umbrel.local', httpPort: 80, httpsPort: 443, forceHttps: true}
			await this.#saveSettings(settings)
		}

		// Generate certificates if they don't exist and Caddy is enabled
		if (settings.enabled) {
			await this.#ensureCertificatesExist(settings)
			await this.#updateCaddyConfig(settings)
			await this.#restartCaddy()
		}

		this.#logger.log('Caddy module started')
	}

	async stop() {
		this.#logger.log('Stopping Caddy module')
		try {
			await $`docker stop umbrel_caddy 2>/dev/null || true`
		} catch (error) {
			this.#logger.error('Failed to stop Caddy container', error as Error)
		}
	}

	async isEnabled(): Promise<boolean> {
		const settings = await this.#loadSettings()
		return settings.enabled ?? false
	}

	async setEnabled(enabled: boolean) {
		const currentSettings = await this.#loadSettings()
		const newSettings: CaddySettings = {...currentSettings, enabled}
		
		this.#logger.log(`Setting Caddy enabled to ${enabled}`)
		await this.#saveSettings(newSettings)

		if (enabled) {
			await this.#ensureCertificatesExist(newSettings)
			await this.#updateCaddyConfig(newSettings)
			await this.#restartCaddy()
		} else {
			await this.stop()
		}
	}

	async getSettings(): Promise<CaddySettings> {
		return await this.#loadSettings()
	}

	async updateSettings(settings: Partial<CaddySettings>) {
		const currentSettings = await this.#loadSettings()
		const newSettings: CaddySettings = {...currentSettings, ...settings}
		
		// Validate
		CaddySettingsSchema.parse(newSettings)
		
		await this.#saveSettings(newSettings)
		
		// If enabled, update Caddy configuration
		if (newSettings.enabled) {
			await this.#ensureCertificatesExist(newSettings)
			await this.#updateCaddyConfig(newSettings)
			await this.#restartCaddy()
		}

		return newSettings
	}

	async registerApp(appId: string, proxyHost: string, proxyPort: number, path?: string) {
		const settings = await this.#loadSettings()
		if (!settings.enabled) {
			this.#logger.log(`Caddy not enabled, skipping registration of app ${appId}`)
			return
		}

		this.#logger.log(`Registering app ${appId} with Caddy at ${proxyHost}:${proxyPort}`)
		
		const route: CaddyRoute = {appId, proxyHost, proxyPort, path}
		this.#routes.set(appId, route)
		
		await this.#updateCaddyConfig(settings)
		await this.#reloadCaddyConfig()
	}

	async unregisterApp(appId: string) {
		const settings = await this.#loadSettings()
		
		this.#logger.log(`Unregistering app ${appId} from Caddy`)
		this.#routes.delete(appId)
		
		if (settings.enabled) {
			await this.#updateCaddyConfig(settings)
			await this.#reloadCaddyConfig()
		}
	}

	async getCertificateFingerprint(): Promise<string | null> {
		const settings = await this.#loadSettings()
		if (!settings.enabled) return null

		const certPath = settings.certificatePath || `${this.#certsPath}/umbrel.crt`
		
		try {
			if (!await fse.pathExists(certPath)) return null

			// Read certificate and calculate fingerprint
			const cert = await fse.readFile(certPath, 'utf8')
			
			// Extract the DER-encoded certificate and calculate SHA256
			const match = cert.match(/-----BEGIN CERTIFICATE-----(\n|.)*-----END CERTIFICATE-----/)
			if (!match) return null

			const certBody = match[0]
				.replace(/-----BEGIN CERTIFICATE-----/, '')
				.replace(/-----END CERTIFICATE-----/, '')
				.replace(/\s/g, '')
			
			const der = Buffer.from(certBody, 'base64')
			const hash = crypto.createHash('sha256').update(der).digest('hex')
			
			// Format as fingerprint (XX:XX:XX...)
			return hash.match(/.{2}/g)?.join(':').toUpperCase() || null
		} catch (error) {
			this.#logger.error('Failed to calculate certificate fingerprint', error as Error)
			return null
		}
	}

	async #loadSettings(): Promise<CaddySettings> {
		try {
			if (!await fse.pathExists(this.#settingsFile)) {
				return {enabled: false, domain: 'umbrel.local', httpPort: 80, httpsPort: 443, forceHttps: true}
			}
			const content = await fse.readFile(this.#settingsFile, 'utf8')
			const parsed = yaml.load(content) as CaddySettings
			return parsed || {enabled: false, domain: 'umbrel.local', httpPort: 80, httpsPort: 443, forceHttps: true}
		} catch (error) {
			this.#logger.error('Failed to load Caddy settings', error as Error)
			return {enabled: false, domain: 'umbrel.local', httpPort: 80, httpsPort: 443, forceHttps: true}
		}
	}

	async #saveSettings(settings: CaddySettings): Promise<void> {
		try {
			await fse.writeFile(this.#settingsFile, yaml.dump(settings), 'utf8')
		} catch (error) {
			this.#logger.error('Failed to save Caddy settings', error as Error)
		}
	}

	async #ensureCertificatesExist(settings: CaddySettings) {
		const certPath = settings.certificatePath || `${this.#certsPath}/umbrel.crt`
		const keyPath = settings.privateKeyPath || `${this.#certsPath}/umbrel.key`

		// Check if certificates already exist
		if (await fse.pathExists(certPath) && await fse.pathExists(keyPath)) {
			this.#logger.log('Certificates already exist, skipping generation')
			return
		}

		this.#logger.log('Generating self-signed certificates for Caddy')
		
		const domain = settings.domain || 'umbrel.local'
		const days = 3650 // 10 years
		
		try {
			// Generate private key and certificate using openssl
			await $`openssl req -x509 -nodes -days ${days} -newkey rsa:2048 -keyout ${keyPath} -out ${certPath} -subj "/CN=${domain}/O=Umbrel/C=US" -addext "subjectAltName=DNS:${domain},DNS:*.${domain},IP:127.0.0.1"`
			
			// Set proper permissions
			await $`chmod 644 ${certPath}`
			await $`chmod 600 ${keyPath}`
			
			this.#logger.log('Certificates generated successfully')
		} catch (error) {
			this.#logger.error('Failed to generate certificates', error as Error)
			throw new Error('Failed to generate self-signed certificates')
		}
	}

	async #updateCaddyConfig(settings: CaddySettings) {
		const routes = Array.from(this.#routes.values())
		
		// Generate Caddyfile
		const caddyfile = generateCaddyfile(settings, routes)
		await fse.writeFile(this.#caddyfilePath, caddyfile)
		this.#logger.log('Caddyfile updated')

		// Also generate JSON config for admin API
		const config = buildCaddyConfig(settings, routes)
		await fse.writeFile(this.#configPath, JSON.stringify(config, null, 2))
		this.#logger.log('Caddy JSON config updated')
	}

	async #restartCaddy() {
		this.#logger.log('Restarting Caddy container')
		
		try {
			// Stop existing container if running
			await $`docker stop umbrel_caddy 2>/dev/null || true`
			await $`docker rm umbrel_caddy 2>/dev/null || true`
			
			// Start new container using docker-compose
			const currentFilename = fileURLToPath(import.meta.url)
			const currentDirname = dirname(currentFilename)
			const composePath = join(currentDirname, 'legacy-compat/docker-compose.caddy.yml')
			
			// Check if compose file exists
			if (!await fse.pathExists(composePath)) {
				this.#logger.log('Caddy docker-compose file not found, skipping container start')
				return
			}
			
			await pRetry(
				async () => {
					await $(
						{cwd: this.#umbreld.dataDirectory},
					)`docker compose --project-name umbrel --file ${composePath} up --detach --remove-orphans`
				},
				{
					retries: 2,
					onFailedAttempt: (error) => {
						this.#logger.error(`Failed to start Caddy container (attempt ${error.attemptNumber})`, error as Error)
					}
				}
			)
			
			this.#logger.log('Caddy container started successfully')
		} catch (error) {
			this.#logger.error('Failed to restart Caddy container', error as Error)
			throw error as Error
		}
	}

	async #reloadCaddyConfig() {
		if (!await this.isEnabled()) {
			return
		}

		this.#logger.log('Reloading Caddy configuration')
		
		try {
			// Try to reload config via admin API
			const config = await fse.readFile(this.#configPath, 'utf8')
			
			// Get Caddy container IP
			try {
				const {stdout: caddyIp} = await $`docker inspect -f {{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}} umbrel_caddy 2>/dev/null || echo ""`
				
				if (caddyIp.trim()) {
					// POST config to admin API
					await $`curl -s -X POST http://${caddyIp.trim()}:2019/load -H "Content-Type: application/json" -d '${config}'`
					this.#logger.log('Caddy config reloaded via admin API')
					return
				}
			} catch {
				// Container might not be running, fall through to restart
			}
			
			// Fallback: restart container
			this.#logger.log('Admin API not available, restarting Caddy container')
			const settings = await this.#loadSettings()
			await this.#restartCaddy()
			
		} catch (error) {
			this.#logger.error('Failed to reload Caddy config', error as Error)
			// Non-fatal, continue
		}
	}
}
