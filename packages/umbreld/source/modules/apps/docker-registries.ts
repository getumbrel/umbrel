import path from 'node:path'
import crypto from 'node:crypto'
import fse from 'fs-extra'
import Dockerode from 'dockerode'

import type Umbreld from '../../index.js'
import {writeFileDurably} from '../utilities/durable-filesystem.js'

export type DockerRegistryCredential = {
	id: string
	url: string
	username: string
	password: string
	createdAt: number
}

export type DockerRegistryPublic = {
	id: string
	url: string
	username: string
	createdAt: number
}

export function normalizeRegistryHost(urlOrHost: string): string {
	let host = urlOrHost.trim()
	// Strip http:// or https://
	host = host.replace(/^https?:\/\//i, '')
	// Strip trailing slashes and paths
	host = host.split('/')[0]
	// Lowercase
	host = host.toLowerCase()
	// Normalize official Docker Hub aliases
	if (
		host === 'docker.io' ||
		host === 'index.docker.io' ||
		host === 'index.docker.io/v1' ||
		host === 'registry-1.docker.io'
	) {
		return 'docker.io'
	}
	return host
}

export function parseImageRegistry(image: string): string {
	let ref = image.trim()
	// Strip image digest if present
	const atIndex = ref.indexOf('@')
	if (atIndex !== -1) {
		ref = ref.slice(0, atIndex)
	}
	// Strip tag if present (tag is after the last ':' provided it appears after the last '/')
	const lastSlash = ref.lastIndexOf('/')
	const lastColon = ref.lastIndexOf(':')
	if (lastColon > lastSlash) {
		ref = ref.slice(0, lastColon)
	}

	const slashIndex = ref.indexOf('/')
	if (slashIndex === -1) {
		// e.g. "ubuntu" or "nginx" -> Docker Hub
		return 'docker.io'
	}

	const firstComponent = ref.slice(0, slashIndex)
	// If the first component has a dot, colon (port), or is localhost, it is a registry host
	if (firstComponent.includes('.') || firstComponent.includes(':') || firstComponent === 'localhost') {
		return normalizeRegistryHost(firstComponent)
	}

	// e.g. "library/ubuntu" or "username/my-app" -> Docker Hub
	return 'docker.io'
}

export function formatDockerConfigJson(registries: DockerRegistryCredential[]): string {
	const auths: Record<string, {auth: string}> = {}
	for (const reg of registries) {
		const auth = Buffer.from(`${reg.username}:${reg.password}`).toString('base64')
		const host = normalizeRegistryHost(reg.url)
		if (host === 'docker.io') {
			auths['https://index.docker.io/v1/'] = {auth}
			auths['docker.io'] = {auth}
		} else {
			auths[host] = {auth}
			auths[`https://${host}`] = {auth}
		}
	}
	return JSON.stringify({auths}, null, 2)
}

export default class DockerRegistries {
	readonly #umbreld: Umbreld

	constructor(umbreld: Umbreld) {
		this.#umbreld = umbreld
	}

	get dockerConfigDirectory(): string {
		return path.join(this.#umbreld.dataDirectory, 'docker-config')
	}

	get dockerConfigFilePath(): string {
		return path.join(this.dockerConfigDirectory, 'config.json')
	}

	async init(): Promise<void> {
		await fse.ensureDir(this.dockerConfigDirectory, 0o700)
		await this.syncDockerConfigFile()
	}

	async getCredentials(): Promise<DockerRegistryCredential[]> {
		const records = (await this.#umbreld.store.get('dockerRegistries')) ?? []
		return Array.isArray(records) ? records : []
	}

	async list(): Promise<DockerRegistryPublic[]> {
		const credentials = await this.getCredentials()
		return credentials.map(({id, url, username, createdAt}) => ({
			id,
			url,
			username,
			createdAt,
		}))
	}

	async add({
		url,
		username,
		password,
	}: {
		url: string
		username: string
		password: string
	}): Promise<DockerRegistryPublic> {
		const trimmedUrl = url.trim()
		const trimmedUsername = username.trim()
		const trimmedPassword = password.trim()
		if (!trimmedUrl) throw new Error('Registry URL is required')
		if (!trimmedUsername) throw new Error('Registry username is required')
		if (!trimmedPassword) throw new Error('Registry password or token is required')

		const normalizedHost = normalizeRegistryHost(trimmedUrl)
		const credentials = await this.getCredentials()

		// Check if a credential for this host already exists, update if so
		const existingIndex = credentials.findIndex((cred) => normalizeRegistryHost(cred.url) === normalizedHost)

		let record: DockerRegistryCredential
		if (existingIndex !== -1) {
			record = {
				...credentials[existingIndex],
				url: trimmedUrl,
				username: trimmedUsername,
				password: trimmedPassword,
			}
			credentials[existingIndex] = record
		} else {
			record = {
				id: crypto.randomUUID(),
				url: trimmedUrl,
				username: trimmedUsername,
				password: trimmedPassword,
				createdAt: Date.now(),
			}
			credentials.push(record)
		}

		await this.#umbreld.store.set('dockerRegistries', credentials)
		await this.syncDockerConfigFile()

		return {
			id: record.id,
			url: record.url,
			username: record.username,
			createdAt: record.createdAt,
		}
	}

	async remove(idOrUrl: string): Promise<boolean> {
		const credentials = await this.getCredentials()
		const targetNormalized = normalizeRegistryHost(idOrUrl)
		const filtered = credentials.filter(
			(cred) => cred.id !== idOrUrl && normalizeRegistryHost(cred.url) !== targetNormalized,
		)

		if (filtered.length === credentials.length) {
			return false
		}

		await this.#umbreld.store.set('dockerRegistries', filtered)
		await this.syncDockerConfigFile()
		return true
	}

	async getAuthForImage(image: string): Promise<Dockerode.AuthConfig | undefined> {
		const host = parseImageRegistry(image)
		const credentials = await this.getCredentials()
		const match = credentials.find((cred) => normalizeRegistryHost(cred.url) === host)
		if (!match) return undefined

		const serveraddress = host === 'docker.io' ? 'https://index.docker.io/v1/' : host

		return {
			username: match.username,
			password: match.password,
			serveraddress,
		}
	}

	async syncDockerConfigFile(): Promise<void> {
		await fse.ensureDir(this.dockerConfigDirectory, 0o700)
		const credentials = await this.getCredentials()
		const configJson = formatDockerConfigJson(credentials)
		const temporaryFilePath = path.join(this.dockerConfigDirectory, `config.json.${process.pid}.${Date.now()}.tmp`)
		await writeFileDurably(this.dockerConfigFilePath, temporaryFilePath, configJson)
		await fse.chmod(this.dockerConfigFilePath, 0o600).catch(() => {})
	}

	async testCredentials({
		url,
		username,
		password,
	}: {
		url: string
		username: string
		password: string
	}): Promise<{success: boolean; message: string}> {
		const docker = new Dockerode()
		const host = normalizeRegistryHost(url)
		const serveraddress = host === 'docker.io' ? 'https://index.docker.io/v1/' : host

		try {
			await docker.checkAuth({
				username: username.trim(),
				password: password.trim(),
				serveraddress,
			})
			return {success: true, message: 'Authentication successful'}
		} catch (error) {
			return {
				success: false,
				message: error instanceof Error ? error.message : String(error),
			}
		}
	}
}
