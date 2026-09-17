import fsp from 'node:fs/promises'
import nodePath from 'node:path'

import fse from 'fs-extra'
import yaml from 'js-yaml'
import {z} from 'zod'

import type {MachineDefinition} from './domain.js'
import {machineIdSchema} from './machine-id.js'

const portForwardSchema = z.object({
	id: z.string().min(1),
	protocol: z.enum(['tcp', 'udp']),
	hostPort: z.number().int().min(1).max(65_535),
	guestPort: z.number().int().min(1).max(65_535),
})

const machineDefinitionSchema = z
	.object({
		version: z.literal(1),
		id: machineIdSchema,
		name: z.string().min(1).max(100),
		osId: z.string(),
		osName: z.string(),
		osVersion: z.string(),
		osVariant: z.string().optional(),
		arch: z.enum(['amd64', 'arm64']),
		platformProfile: z.enum(['modern-x86', 'windows-7-x86', 'legacy-x86', 'windows-98-x86', 'modern-arm64']),
		machineType: z.string(),
		firmware: z.enum(['uefi', 'bios']),
		diskBus: z.enum(['virtio', 'sata']).optional(),
		diskPath: z
			.string()
			.refine((value) => {
				const normalized = nodePath.posix.normalize(value)
				return (
					value === normalized &&
					(normalized.startsWith('/External/') || normalized.startsWith('/Network/')) &&
					normalized.toLowerCase().endsWith('.qcow2')
				)
			}, '[machine-external-disk-location-invalid]')
			.optional(),
		uuid: z.string().uuid(),
		macAddress: z.string().regex(/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/),
		// Address ranges are runtime policy and may change across an OTA. Accept a
		// stale persisted value here so Machines can migrate it before exposing or
		// passing the definition to libvirt.
		ipAddress: z.string().optional(),
		diskSizeGb: z.number().int().min(1).max(10_000),
		cores: z.number().int().min(1).max(64),
		memoryMb: z.number().int().min(128).max(1_048_576).optional(),
		// Read old machine definitions after an OTA and canonicalize them on the
		// next write. New definitions use MiB so historically accurate guests can
		// request less than 1 GiB.
		memoryGb: z.number().int().min(1).max(1_024).optional(),
		username: z.string().optional(),
		autostart: z.boolean(),
		pinned: z.boolean(),
		createdAt: z.number().int(),
		firstBootSetup: z
			.object({
				startedAt: z.number().int(),
				tokenHash: z.string().regex(/^[0-9a-f]{64}$/),
				manual: z.boolean().optional(),
			})
			.optional(),
		installSource: z
			.union([
				z.object({osId: z.string().min(1), imagePath: z.never().optional()}),
				z.object({osId: z.never().optional(), imagePath: z.string().min(1)}),
			])
			.optional(),
		secureBoot: z.boolean().optional(),
		tpm: z.boolean().optional(),
		installMedia: z.enum(['media/install.iso', 'media/install.img', 'media/seed.iso']).optional(),
		seedMedia: z.literal('media/seed.iso').optional(),
		bootMedia: z.literal('media/boot.img').optional(),
		portForwards: z.array(portForwardSchema),
	})
	.refine((definition) => definition.memoryMb !== undefined || definition.memoryGb !== undefined, {
		message: 'Machine memory is required',
	})
	.transform(({memoryGb, ...definition}) => ({...definition, memoryMb: definition.memoryMb ?? memoryGb! * 1_024}))

export default class MachineStore {
	root: string

	constructor(dataDirectory: string) {
		this.root = nodePath.join(dataDirectory, 'machines')
	}

	async start() {
		await fse.ensureDir(this.root)
	}

	directory(id: string) {
		machineIdSchema.parse(id)
		return nodePath.join(this.root, id)
	}

	definitionPath(id: string) {
		return nodePath.join(this.directory(id), 'machine.yaml')
	}

	async read(id: string) {
		const contents = await fsp.readFile(this.definitionPath(id), 'utf8')
		return machineDefinitionSchema.parse(yaml.load(contents)) as MachineDefinition
	}

	async list() {
		const entries = await fsp.readdir(this.root, {withFileTypes: true}).catch(() => [])
		const definitions: MachineDefinition[] = []
		for (const entry of entries) {
			if (!entry.isDirectory() || entry.name.startsWith('.')) continue
			try {
				definitions.push(await this.read(entry.name))
			} catch {
				// An invalid/incomplete directory is deliberately not treated as a
				// machine. Creation uses a hidden staging directory and atomic rename.
			}
		}
		return definitions.sort((a, b) => a.createdAt - b.createdAt)
	}

	async write(definition: MachineDefinition, directory = this.directory(definition.id)) {
		machineDefinitionSchema.parse(definition)
		await fse.ensureDir(directory)
		const destination = nodePath.join(directory, 'machine.yaml')
		const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`
		await fsp.writeFile(temporary, yaml.dump(definition, {noRefs: true, lineWidth: 120}), {
			encoding: 'utf8',
			mode: 0o600,
		})
		await fsp.rename(temporary, destination)
	}

	async remove(id: string) {
		await fse.remove(this.directory(id))
	}
}

export {machineDefinitionSchema}
