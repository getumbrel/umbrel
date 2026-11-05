import {Buffer} from 'node:buffer'
import nodePath from 'node:path'

import pRetry from 'p-retry'

import type {createTestVm} from '../test-utilities/create-test-umbreld.ts'
import type {CloudSyncWithStatus} from './cloud.ts'

type CloudClient = {
	files: {
		cloud: {
			syncs: {query: () => Promise<CloudSyncWithStatus[]>}
		}
	}
}

type TestVm = Awaited<ReturnType<typeof createTestVm>>

export const VM_CLOUD_FIXTURE_ROOT = '/home/umbrel/cloud-webdav-source'
export const VM_CLOUD_WEBDAV_PORT = 49321
export const VM_CLOUD_WEBDAV_URL = `http://127.0.0.1:${VM_CLOUD_WEBDAV_PORT}/`
export const VM_CLOUD_WEBDAV_TLS_URL = `https://127.0.0.1:${VM_CLOUD_WEBDAV_PORT}/`
export const VM_CLOUD_WEBDAV_USERNAME = 'cloud-user'
export const VM_CLOUD_WEBDAV_PASSWORD = 'cloud-password'
export const VM_CLOUD_WEBDAV_RELEASE_PATH = '/tmp/cloud-webdav-release'
// Outside /tmp so the ledger survives VM power cycles, and outside the fixture
// root so it never becomes part of the synced source tree
export const VM_CLOUD_WEBDAV_MUTATION_LOG = '/home/umbrel/cloud-webdav-mutations.log'

const fixtureSystemPath = (path: string) => {
	const normalized = nodePath.posix.normalize(path)
	if (!path.startsWith('/') || normalized !== path || path.includes('\0') || path.includes('\\')) {
		throw new Error('[invalid-fixture-path]')
	}
	return nodePath.posix.join(VM_CLOUD_FIXTURE_ROOT, path)
}

export const startVmCloudWebDav = async (
	umbreld: TestVm,
	{stall, tls = false}: {stall?: {path: string; afterBytes: number}; tls?: boolean} = {},
) => {
	if (stall) {
		fixtureSystemPath(stall.path)
		if (!Number.isInteger(stall.afterBytes) || stall.afterBytes < 1) throw new Error('[invalid-fixture-stall]')
	}
	const encodedStall = stall ? Buffer.from(JSON.stringify(stall)).toString('base64') : '-'
	const tlsMode = tls ? 'tls' : 'plain'
	const url = tls ? VM_CLOUD_WEBDAV_TLS_URL : VM_CLOUD_WEBDAV_URL
	const curlTlsOption = tls ? '--insecure' : ''
	await umbreld.vm.sshAsRoot(`
set -eu
mkdir -p '${VM_CLOUD_FIXTURE_ROOT}'
chown -R umbrel:umbrel '${VM_CLOUD_FIXTURE_ROOT}'
rm -f '${VM_CLOUD_WEBDAV_RELEASE_PATH}'
if [ -f /tmp/cloud-webdav.pid ]; then
	pid="$(cat /tmp/cloud-webdav.pid)"
	kill "$pid" 2>/dev/null || true
	attempt=0
	while kill -0 "$pid" 2>/dev/null && [ "$attempt" -lt 50 ]; do
		attempt=$((attempt + 1))
		sleep 0.1
	done
	kill -KILL "$pid" 2>/dev/null || true
fi
runuser -u umbrel -- sh -c 'nohup /usr/local/bin/node /opt/umbreld/source/modules/files/cloud-webdav-vm-fixture.ts ${encodedStall} ${tlsMode} >/tmp/cloud-webdav.log 2>&1 </dev/null & echo $!' > /tmp/cloud-webdav.pid
`)
	await pRetry(
		async () => {
			const ready = await umbreld.vm.ssh(
				`kill -0 "$(cat /tmp/cloud-webdav.pid)" && curl ${curlTlsOption} --silent --fail --user '${VM_CLOUD_WEBDAV_USERNAME}:${VM_CLOUD_WEBDAV_PASSWORD}' --request PROPFIND --header 'Depth: 0' '${url}' >/dev/null && echo ready`,
			)
			if (ready.trim() !== 'ready') throw new Error('[webdav-fixture-not-ready]')
		},
		{retries: 30, factor: 1, minTimeout: 500, maxTimeout: 500},
	)
	return url
}

export const stopVmCloudWebDav = async (umbreld: TestVm) => {
	await umbreld.vm.sshAsRoot(`
set -eu
if [ -f /tmp/cloud-webdav.pid ]; then
	pid="$(cat /tmp/cloud-webdav.pid)"
	kill "$pid" 2>/dev/null || true
	attempt=0
	while kill -0 "$pid" 2>/dev/null && [ "$attempt" -lt 50 ]; do
		attempt=$((attempt + 1))
		sleep 0.1
	done
	kill -KILL "$pid" 2>/dev/null || true
	rm -f /tmp/cloud-webdav.pid
fi
`)
}

export const releaseVmCloudWebDav = async (umbreld: TestVm) => {
	await umbreld.vm.sshAsRoot(`
set -eu
touch '${VM_CLOUD_WEBDAV_RELEASE_PATH}'
`)
}

export const createVmCloudFixtureDirectory = async (umbreld: TestVm, path: string) => {
	const target = fixtureSystemPath(path)
	await umbreld.vm.sshAsRoot(`
set -eu
mkdir -p '${target}'
chown -R umbrel:umbrel '${VM_CLOUD_FIXTURE_ROOT}'
`)
}

export const writeVmCloudFixture = async (umbreld: TestVm, path: string, contents: string) => {
	const target = fixtureSystemPath(path)
	const encodedContents = Buffer.from(contents).toString('base64')
	await umbreld.vm.sshAsRoot(`
set -eu
mkdir -p '${nodePath.posix.dirname(target)}'
printf '%s' '${encodedContents}' | base64 -d > '${target}'
chown -R umbrel:umbrel '${VM_CLOUD_FIXTURE_ROOT}'
`)
}

export const readVmCloudFixture = async (umbreld: TestVm, path: string) => {
	const target = fixtureSystemPath(path)
	const encodedContents = await umbreld.vm.ssh(`base64 -w 0 '${target}'`)
	return Buffer.from(encodedContents.trim(), 'base64').toString()
}

export const removeVmCloudFixture = async (umbreld: TestVm, path: string) => {
	const target = fixtureSystemPath(path)
	await umbreld.vm.sshAsRoot(`
set -eu
rm -rf -- '${target}'
`)
}

export const createLargeVmCloudFixture = async (umbreld: TestVm, path: string, sizeMiB: number) => {
	if (!Number.isInteger(sizeMiB) || sizeMiB < 1 || sizeMiB > 1024) throw new Error('[invalid-fixture-size]')
	const target = fixtureSystemPath(path)
	await umbreld.vm.sshAsRoot(`
set -eu
mkdir -p '${nodePath.posix.dirname(target)}'
dd if=/dev/zero of='${target}' bs=1M count=${sizeMiB} status=none
chown -R umbrel:umbrel '${VM_CLOUD_FIXTURE_ROOT}'
	`)
}

export const waitForSync = async (
	client: CloudClient,
	syncId: string,
	predicate: (sync: CloudSyncWithStatus) => boolean,
	{timeout = 60_000}: {timeout?: number} = {},
) =>
	pRetry(
		async () => {
			const sync = (await client.files.cloud.syncs.query()).find(({id}) => id === syncId)
			if (!sync || !predicate(sync)) {
				throw new Error(`[cloud-not-ready] ${JSON.stringify(sync?.status)}`)
			}
			return sync
		},
		{retries: Math.ceil(timeout / 250), factor: 1, minTimeout: 250, maxTimeout: 250},
	)

export const waitForSyncRemoval = async (
	client: CloudClient,
	syncId: string,
	{timeout = 60_000}: {timeout?: number} = {},
) =>
	pRetry(
		async () => {
			if ((await client.files.cloud.syncs.query()).some(({id}) => id === syncId)) {
				throw new Error('[cloud-still-present]')
			}
			return true
		},
		{retries: Math.ceil(timeout / 250), factor: 1, minTimeout: 250, maxTimeout: 250},
	)
