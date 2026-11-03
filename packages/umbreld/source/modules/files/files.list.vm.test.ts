import {randomUUID} from 'node:crypto'

import {expect, beforeAll, afterAll, test} from 'vitest'
import yaml from 'js-yaml'
import pRetry from 'p-retry'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'

// The entire files.list() API runs end-to-end here, including recovery from a
// real filesystem status failure caused by a disconnected FUSE mount.

let umbreld: Awaited<ReturnType<typeof createTestVm>>

// Each test uses uniquely named directories so no cleanup between tests is
// needed
beforeAll(async () => {
	umbreld = await createTestVm({device: 'umbrel-home'})
	await umbreld.vm.powerOn()
	await umbreld.registerAndLogin()
})

afterAll(async () => {
	await umbreld.cleanup()
})

const guestHome = '/home/umbrel/umbrel/home'

// Create a file through the files API
async function uploadFile(path: string, content: string) {
	await umbreld.api.post(`files/upload?path=${encodeURIComponent(path)}`, {body: content})
}

test('list() throws invalid error whithout auth token', async () => {
	await expect(umbreld.unauthenticatedClient.files.list.query({path: '/'})).rejects.toThrow('Invalid token')
})

test('list() throws on directory traversal attempt', async () => {
	await expect(umbreld.client.files.list.query({path: '/Home/../../../../etc'})).rejects.toThrow('[invalid-base]')
})

test('list() throws on symlink traversal attempt', async () => {
	// Create a symlink to the root directory at the virtual path
	// /Home/symlink-to-root (no product surface creates symlinks, so seed it
	// over SSH)
	await umbreld.vm.ssh(`ln -s / ${guestHome}/symlink-to-root`)
	// Ensure the symlink exists at the correct location
	await expect(umbreld.client.files.list.query({path: '/Home'})).resolves.toMatchObject({
		files: expect.arrayContaining([
			expect.objectContaining({
				name: 'symlink-to-root',
			}),
		]),
	})
	// Attempt to list it
	await expect(umbreld.client.files.list.query({path: '/Home/symlink-to-root'})).rejects.toThrow('[escapes-base]')

	// Remove the symlink so it doesn't affect the /Home listing tests
	await umbreld.vm.ssh(`rm ${guestHome}/symlink-to-root`)
})

test('list() throws on relative paths', async () => {
	await Promise.all(
		['', ' ', '.', '..', 'Home', 'Home/..', 'Home/Documents'].map((path) =>
			expect(umbreld.client.files.list.query({path})).rejects.toThrow('[path-not-absolute]'),
		),
	)
})

test('list() throws on non existent paths', async () => {
	await Promise.all([
		expect(umbreld.client.files.list.query({path: '/DoesNotExist'})).rejects.toThrow('[invalid-base]'),
		expect(umbreld.client.files.list.query({path: '/Home/DoesNotExist'})).rejects.toThrow('[does-not-exist]'),
	])
})

test('list() skips entries whose filesystem status cannot be read', async () => {
	const virtualDirectory = '/Home/status-failure-test'
	const guestDirectory = `${guestHome}/status-failure-test`
	const mountSource = '/tmp/files-list-status-failure-source'
	const mountPoint = `${guestDirectory}/disconnected-mount`

	await umbreld.client.files.createDirectory.mutate({path: virtualDirectory})
	await uploadFile(`${virtualDirectory}/readable.txt`, 'readable content')

	try {
		// bindfs is part of the production OS image. Kill its FUSE daemon without
		// unmounting it so lstat() on this one directory entry fails with a real
		// kernel error (typically ENOTCONN), as it can for a lost filesystem.
		await umbreld.vm.sshAsRoot(`
set -eu
source='${mountSource}'
mountpoint='${mountPoint}'
log='/tmp/files-list-status-failure-bindfs.log'

rm -rf "$source"
mkdir -p "$source" "$mountpoint"
printf 'mounted content' > "$source/file.txt"

bindfs -f "$source" "$mountpoint" > "$log" 2>&1 &
pid=$!

attempt=0
while ! mountpoint -q "$mountpoint"; do
	attempt=$((attempt + 1))
	if [ "$attempt" -ge 100 ]; then
		cat "$log" >&2
		kill "$pid" 2>/dev/null || true
		exit 1
	fi
	sleep 0.1
done

kill -9 "$pid"
wait "$pid" 2>/dev/null || true

attempt=0
while stat "$mountpoint" >/dev/null 2>&1; do
	attempt=$((attempt + 1))
	if [ "$attempt" -ge 100 ]; then
		echo 'FUSE mount still accepted stat calls after its daemon exited' >&2
		exit 1
	fi
	sleep 0.1
done
`)

		const listing = await umbreld.client.files.list.query({path: virtualDirectory})
		const names = listing.files.map((file) => file.name)

		expect(names).toContain('readable.txt')
		expect(names).not.toContain('disconnected-mount')
	} finally {
		// Always detach the dead FUSE mount so it cannot affect later tests or VM
		// shutdown, even if the listing assertion fails.
		await umbreld.vm.sshAsRoot(`
mountpoint='${mountPoint}'
fusermount3 -uz "$mountpoint" 2>/dev/null || umount -l "$mountpoint" 2>/dev/null || true
rm -rf '${mountSource}' '${guestDirectory}' /tmp/files-list-status-failure-bindfs.log
`)
	}
})

test('list() lists the root directory', async () => {
	const listing = await umbreld.client.files.list.query({path: '/'})
	const expectedNames = ['Apps', 'Backups', 'External', 'Home', 'Machines', 'Network', 'Trash']

	expect(listing).toMatchObject({
		name: '',
		path: '/',
		type: 'directory',
		modified: expect.any(Number),
		operations: [],
		files: expectedNames.map((name) => ({
			name,
			path: `/${name}`,
			type: 'directory',
			modified: expect.any(Number),
			operations: expect.arrayContaining(['copy']),
		})),
	})
	expect(listing.size).toBeUndefined()
})

test('list() exposes machine data and only protects roots backed by a valid machine', async () => {
	const machineDirectory = '/home/umbrel/umbrel/machines/test-machine'
	const machineYaml = Buffer.from(
		yaml.dump({
			version: 1,
			id: 'test-machine',
			name: 'Test machine',
			osId: 'custom',
			osName: 'Custom',
			osVersion: 'Custom image',
			arch: 'amd64',
			platformProfile: 'modern-x86',
			machineType: 'pc-q35-9.2',
			firmware: 'uefi',
			uuid: randomUUID(),
			macAddress: '02:00:00:00:00:01',
			diskSizeGb: 1,
			cores: 1,
			memoryMb: 1024,
			autostart: false,
			pinned: false,
			createdAt: Date.now(),
			portForwards: [],
		}),
	).toString('base64')
	await umbreld.vm.sshAsRoot(
		`mkdir -p ${machineDirectory} && printf 'editable machine data' > ${machineDirectory}/notes.txt && printf '%s' '${machineYaml}' | base64 -d > ${machineDirectory}/machine.yaml`,
	)

	await expect(umbreld.client.files.list.query({path: '/Machines'})).resolves.toMatchObject({
		path: '/Machines',
		files: [
			{
				path: '/Machines/test-machine',
				operations: expect.not.arrayContaining(['move', 'rename', 'trash', 'delete', 'share']),
			},
		],
	})
	await expect(umbreld.client.files.list.query({path: '/Machines/test-machine'})).resolves.toMatchObject({
		files: expect.arrayContaining([
			expect.objectContaining({
				path: '/Machines/test-machine/notes.txt',
				operations: expect.not.arrayContaining(['writable', 'move', 'rename', 'trash', 'delete', 'share']),
			}),
		]),
	})

	await umbreld.vm.sshAsRoot(`rm ${machineDirectory}/machine.yaml`)
	await expect(umbreld.client.files.list.query({path: '/Machines'})).resolves.toMatchObject({
		files: [
			{
				path: '/Machines/test-machine',
				operations: expect.arrayContaining(['move', 'rename', 'trash']),
			},
		],
	})

	await umbreld.vm.sshAsRoot(`rm -rf ${machineDirectory}`)
})

test('list() lists the /Home directory', async () => {
	await expect(umbreld.client.files.list.query({path: '/Home'})).resolves.toMatchObject({
		name: 'Home',
		path: '/Home',
		type: 'directory',
		modified: expect.any(Number),
		operations: expect.arrayContaining(['copy']),
		files: [
			{
				name: 'Documents',
				path: '/Home/Documents',
				type: 'directory',
				modified: expect.any(Number),
				operations: expect.arrayContaining(['move', 'copy']),
			},
			{
				name: 'Downloads',
				path: '/Home/Downloads',
				type: 'directory',
				modified: expect.any(Number),
				operations: expect.arrayContaining(['copy']),
			},
			{
				name: 'Photos',
				path: '/Home/Photos',
				type: 'directory',
				modified: expect.any(Number),
				operations: expect.arrayContaining(['move', 'copy']),
			},
			{
				name: 'Videos',
				path: '/Home/Videos',
				type: 'directory',
				modified: expect.any(Number),
				operations: expect.arrayContaining(['move', 'copy']),
			},
		],
	})
})

test('list() returns correct types for various files and directories', async () => {
	// Create a test directory with files of different types
	await umbreld.client.files.createDirectory.mutate({path: '/Home/mime-test'})

	// Create test files with different mime types
	await Promise.all([
		uploadFile('/Home/mime-test/text.txt', ''),
		uploadFile('/Home/mime-test/image.png', ''),
		uploadFile('/Home/mime-test/video.mp4', ''),
		uploadFile('/Home/mime-test/unknown', ''),
	])

	// Create a subdirectory
	await umbreld.client.files.createDirectory.mutate({path: '/Home/mime-test/subdir'})

	// Create a symlink (no product surface creates symlinks)
	await umbreld.vm.ssh(`ln -s ${guestHome}/mime-test/text.txt ${guestHome}/mime-test/symlink-to-text`)

	// Query the directory
	const mimeTypes = await umbreld.client.files.list.query({path: '/Home/mime-test'})

	// Check the types
	;[
		{name: 'text.txt', type: 'text/plain'},
		{name: 'image.png', type: 'image/png'},
		{name: 'video.mp4', type: 'video/mp4'},
		{name: 'unknown', type: 'application/octet-stream'},
		{name: 'subdir', type: 'directory'},
		{name: 'symlink-to-text', type: 'symbolic-link'},
	].forEach(({name, type}) => {
		expect(mimeTypes.files.find((file) => file.name === name)?.type).toEqual(type)
	})
})

test('list() shows dotfiles', async () => {
	// Create a test directory with dotfiles
	await umbreld.client.files.createDirectory.mutate({path: '/Home/dotfiles-test'})

	// Create regular files and dotfiles
	await Promise.all([
		uploadFile('/Home/dotfiles-test/regular.txt', ''),
		uploadFile('/Home/dotfiles-test/.dotfile', ''),
		uploadFile('/Home/dotfiles-test/.hidden-config', ''),
	])

	// Query the directory listing
	const listing = await umbreld.client.files.list.query({
		path: '/Home/dotfiles-test',
	})

	// Verify that dotfiles are included in the listing
	expect(listing.files).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				name: '.dotfile',
				path: '/Home/dotfiles-test/.dotfile',
			}),
			expect.objectContaining({
				name: '.hidden-config',
				path: '/Home/dotfiles-test/.hidden-config',
			}),
		]),
	)
})

test('list() keeps Files visibility independent from Cloud junk filtering', async () => {
	// Create a test directory
	await umbreld.client.files.createDirectory.mutate({path: '/Home/visibility-test'})

	// These files typically appear out-of-band (for example over SMB), so seed
	// both the Files-hidden names and Cloud-only junk names over SSH.
	await umbreld.vm.ssh(
		`touch ${guestHome}/visibility-test/{regular.txt,.DS_Store,.directory,.umbrel-watcher-health-check,partial.umbrel-upload,claimed.umbrel-trash,Thumbs.db,desktop.ini,._photo.jpg}`,
	)

	// Query the directory listing
	const listing = await umbreld.client.files.list.query({
		path: '/Home/visibility-test',
	})
	const names = listing.files.map((file) => file.name)

	// Cloud ignores additional platform metadata when mirroring, but that must
	// not make those names globally invisible in Files.
	expect(names).not.toContain('.DS_Store')
	expect(names).not.toContain('.directory')
	expect(names).not.toContain('.umbrel-watcher-health-check')
	expect(names).not.toContain('partial.umbrel-upload')
	expect(names).not.toContain('claimed.umbrel-trash')
	expect(names).toEqual(expect.arrayContaining(['regular.txt', 'Thumbs.db', 'desktop.ini', '._photo.jpg']))
})

test('list() paginates directory listings', async () => {
	// Create a test directory with 150 files. Bulk fixtures are seeded with a
	// single SSH command, uploading them one-by-one through the API would be
	// needlessly slow.
	await umbreld.vm.ssh(`mkdir -p ${guestHome}/pagination-test && touch ${guestHome}/pagination-test/file{001..150}.txt`)

	// Test first page (100 files because that's the default limit)
	const firstPage = await umbreld.client.files.list.query({path: '/Home/pagination-test'})
	expect(firstPage.files).toHaveLength(100)
	expect(firstPage.files[0].name).toBe('file001.txt')
	expect(firstPage.files[99].name).toBe('file100.txt')
	expect(firstPage.totalFiles).toBe(150)
	expect(firstPage.hasMore).toBe(true)

	// Test second page (50 files)
	const secondPage = await umbreld.client.files.list.query({
		path: '/Home/pagination-test',
		lastFile: firstPage.files[99].name,
	})
	expect(secondPage.files).toHaveLength(50)
	expect(secondPage.files[0].name).toBe('file101.txt')
	expect(secondPage.files[49].name).toBe('file150.txt')
	expect(secondPage.totalFiles).toBe(150)
	expect(secondPage.hasMore).toBe(false)

	// Test third page (0 files)
	const thirdPage = await umbreld.client.files.list.query({
		path: '/Home/pagination-test',
		lastFile: secondPage.files[49].name,
	})
	expect(thirdPage.files).toHaveLength(0)
	expect(thirdPage.totalFiles).toBe(150)
	expect(thirdPage.hasMore).toBe(false)
})

test('list() paginates directory listings with a custom limit', async () => {
	// Create a test directory with 150 files
	await umbreld.vm.ssh(
		`mkdir -p ${guestHome}/custom-limit-test && touch ${guestHome}/custom-limit-test/file{001..150}.txt`,
	)

	// Test with a custom limit of 42 files
	const customLimit = 42
	const result = await umbreld.client.files.list.query({
		path: '/Home/custom-limit-test',
		limit: customLimit,
	})

	// Verify exact number of files matches the custom limit
	expect(result.files).toHaveLength(customLimit)
	expect(result.files[0].name).toBe('file001.txt')
	expect(result.files[customLimit - 1].name).toBe(`file${customLimit.toString().padStart(3, '0')}.txt`)
	expect(result.totalFiles).toBe(150)
	expect(result.hasMore).toBe(true)
})

test("list() truncates a listing if it's larger than the max listing size", async () => {
	const maxListingSize = 10000
	// Create a test directory with just under the max listing size
	await umbreld.vm.ssh(
		`mkdir -p ${guestHome}/max-listing-size && touch ${guestHome}/max-listing-size/file{1..${maxListingSize - 1}}.txt`,
	)

	// Test results are not truncated
	await expect(umbreld.client.files.list.query({path: '/Home/max-listing-size'})).resolves.not.toHaveProperty(
		'truncatedAt',
	)

	// Create one more file
	await umbreld.vm.ssh(`touch ${guestHome}/max-listing-size/file${maxListingSize}.txt`)

	// Test results are truncated
	await expect(umbreld.client.files.list.query({path: '/Home/max-listing-size'})).resolves.toHaveProperty(
		'truncatedAt',
		maxListingSize,
	)
})

test('list() sorts by name', async () => {
	// Create a test directory with files - using unique path
	await umbreld.client.files.createDirectory.mutate({path: '/Home/sort-by-name-test'})

	// Create test files with different names
	await Promise.all([
		uploadFile('/Home/sort-by-name-test/b.txt', ''),
		uploadFile('/Home/sort-by-name-test/c.txt', ''),
		uploadFile('/Home/sort-by-name-test/a.txt', ''),
	])

	// Test ascending sort
	const ascending = await umbreld.client.files.list.query({
		path: '/Home/sort-by-name-test',
		sortBy: 'name',
		sortOrder: 'ascending',
	})
	expect(ascending.files.map((f) => f.name)).toEqual(['a.txt', 'b.txt', 'c.txt'])

	// Test descending sort
	const descending = await umbreld.client.files.list.query({
		path: '/Home/sort-by-name-test',
		sortBy: 'name',
		sortOrder: 'descending',
	})
	expect(descending.files.map((f) => f.name)).toEqual(['c.txt', 'b.txt', 'a.txt'])
})

test('list() sorts by modified time', async () => {
	// Create files with explicitly different modified times (deterministic,
	// no sleeps needed)
	await umbreld.vm.ssh(
		`mkdir -p ${guestHome}/sort-by-modified-test && cd ${guestHome}/sort-by-modified-test && touch -d '2020-01-01' oldest.txt && touch -d '2021-01-01' middle.txt && touch -d '2022-01-01' newest.txt`,
	)

	// Test ascending sort (oldest first)
	const ascending = await umbreld.client.files.list.query({
		path: '/Home/sort-by-modified-test',
		sortBy: 'modified',
		sortOrder: 'ascending',
	})
	expect(ascending.files.map((f) => f.name)).toEqual(['oldest.txt', 'middle.txt', 'newest.txt'])

	// Test descending sort (newest first)
	const descending = await umbreld.client.files.list.query({
		path: '/Home/sort-by-modified-test',
		sortBy: 'modified',
		sortOrder: 'descending',
	})
	expect(descending.files.map((f) => f.name)).toEqual(['newest.txt', 'middle.txt', 'oldest.txt'])
})

test('list() sorts by size', async () => {
	// Create a test directory with files - using unique path
	await umbreld.client.files.createDirectory.mutate({path: '/Home/sort-by-size-test'})

	// Create files with different sizes
	await uploadFile('/Home/sort-by-size-test/small.txt', 'a')
	await uploadFile('/Home/sort-by-size-test/medium.txt', 'aaa')
	await uploadFile('/Home/sort-by-size-test/large.txt', 'aaaaa')

	// Test ascending sort (smallest first)
	const ascending = await umbreld.client.files.list.query({
		path: '/Home/sort-by-size-test',
		sortBy: 'size',
		sortOrder: 'ascending',
	})
	expect(ascending.files.map((f) => f.name)).toEqual(['small.txt', 'medium.txt', 'large.txt'])

	// Test descending sort (largest first)
	const descending = await umbreld.client.files.list.query({
		path: '/Home/sort-by-size-test',
		sortBy: 'size',
		sortOrder: 'descending',
	})
	expect(descending.files.map((f) => f.name)).toEqual(['large.txt', 'medium.txt', 'small.txt'])
})

test('list() sorts by type', async () => {
	// Create a test directory with files - using unique path
	await umbreld.client.files.createDirectory.mutate({path: '/Home/sort-by-type-test'})

	// Create files with different types
	await uploadFile('/Home/sort-by-type-test/document.txt', '')
	await uploadFile('/Home/sort-by-type-test/image.png', '')
	await uploadFile('/Home/sort-by-type-test/archive.zip', '')

	// Test ascending sort
	const ascending = await umbreld.client.files.list.query({
		path: '/Home/sort-by-type-test',
		sortBy: 'type',
		sortOrder: 'ascending',
	})
	expect(ascending.files.map((f) => f.name)).toEqual(['archive.zip', 'image.png', 'document.txt'])

	// Test descending sort
	const descending = await umbreld.client.files.list.query({
		path: '/Home/sort-by-type-test',
		sortBy: 'type',
		sortOrder: 'descending',
	})
	expect(descending.files.map((f) => f.name)).toEqual(['document.txt', 'image.png', 'archive.zip'])
})

test('list() sorts files numerically by name', async () => {
	// Create a test directory with files named numerically
	await umbreld.vm.ssh(`mkdir -p ${guestHome}/numeric-sort-test && touch ${guestHome}/numeric-sort-test/{0..10}.txt`)

	// Test ascending sort by name
	const ascending = await umbreld.client.files.list.query({
		path: '/Home/numeric-sort-test',
		sortBy: 'name',
		sortOrder: 'ascending',
	})
	expect(ascending.files.map((f) => f.name)).toEqual([
		'0.txt',
		'1.txt',
		'2.txt',
		'3.txt',
		'4.txt',
		'5.txt',
		'6.txt',
		'7.txt',
		'8.txt',
		'9.txt',
		'10.txt',
	])

	// Test descending sort by name
	const descending = await umbreld.client.files.list.query({
		path: '/Home/numeric-sort-test',
		sortBy: 'name',
		sortOrder: 'descending',
	})
	expect(descending.files.map((f) => f.name)).toEqual([
		'10.txt',
		'9.txt',
		'8.txt',
		'7.txt',
		'6.txt',
		'5.txt',
		'4.txt',
		'3.txt',
		'2.txt',
		'1.txt',
		'0.txt',
	])
})

test('list() falls back to name sorting when numeric values are equal', async () => {
	// Create files with the same size but different names
	await umbreld.vm.ssh(
		`mkdir -p ${guestHome}/sort-fallback-test && cd ${guestHome}/sort-fallback-test && for f in {0..10}; do printf 'same size' > $f.txt; done`,
	)

	// Test ascending sort by size, should fall back to name
	const ascending = await umbreld.client.files.list.query({
		path: '/Home/sort-fallback-test',
		sortBy: 'size',
		sortOrder: 'ascending',
	})
	expect(ascending.files.map((f) => f.name)).toEqual([
		'0.txt',
		'1.txt',
		'2.txt',
		'3.txt',
		'4.txt',
		'5.txt',
		'6.txt',
		'7.txt',
		'8.txt',
		'9.txt',
		'10.txt',
	])

	// Test descending sort by size, should fall back to name
	const descending = await umbreld.client.files.list.query({
		path: '/Home/sort-fallback-test',
		sortBy: 'size',
		sortOrder: 'descending',
	})
	expect(descending.files.map((f) => f.name)).toEqual([
		'10.txt',
		'9.txt',
		'8.txt',
		'7.txt',
		'6.txt',
		'5.txt',
		'4.txt',
		'3.txt',
		'2.txt',
		'1.txt',
		'0.txt',
	])
})

test('list() reports indexed directory content sizes including empty directories', async () => {
	// Create a test directory with a subdirectory and files - using unique path
	await umbreld.client.files.createDirectory.mutate({path: '/Home/dir-size-test'})
	await umbreld.client.files.createDirectory.mutate({path: '/Home/dir-size-test/subdir'})
	await umbreld.client.files.createDirectory.mutate({path: '/Home/dir-size-test/empty'})

	// Add files to the subdirectory
	await uploadFile('/Home/dir-size-test/subdir/file1.txt', 'content1')
	await uploadFile('/Home/dir-size-test/subdir/file2.txt', 'content2')

	// Watcher updates are asynchronous, so wait until the ready index reflects
	// both files before checking the public listing response.
	await pRetry(
		async () => {
			const listing = await umbreld.client.files.list.query({path: '/Home/dir-size-test'})
			const subdir = listing.files.find((file) => file.name === 'subdir')
			const empty = listing.files.find((file) => file.name === 'empty')
			expect(subdir).toBeDefined()
			expect(empty).toBeDefined()
			expect(subdir!.size).toBe(16)
			expect(empty!.size).toBe(0)
		},
		{retries: 100, factor: 1, minTimeout: 100, maxTimeout: 100},
	)
})

test('list() reports correct size for files in bytes', async () => {
	// Create a test directory with files - using unique path
	await umbreld.client.files.createDirectory.mutate({path: '/Home/file-size-test'})

	// Create files with specific sizes
	await uploadFile('/Home/file-size-test/file1.txt', '12345') // 5 bytes
	await uploadFile('/Home/file-size-test/file2.txt', '1234567890') // 10 bytes

	// Query the directory listing
	const listing = await umbreld.client.files.list.query({
		path: '/Home/file-size-test',
	})

	// Check that file sizes are reported correctly
	const file1 = listing.files.find((f) => f.name === 'file1.txt')
	expect(file1).toBeDefined()
	expect(file1!.size).toBe(5)

	const file2 = listing.files.find((f) => f.name === 'file2.txt')
	expect(file2).toBeDefined()
	expect(file2!.size).toBe(10)
})

test('list() reports correct modified time for a single file', async () => {
	// Create a test directory - using unique path
	await umbreld.client.files.createDirectory.mutate({path: '/Home/modified-time-test'})

	// Get the guest's time before creating the file (the modified time is set
	// by the VM's clock, so don't compare against the host's clock)
	const beforeCreation = Number(await umbreld.vm.ssh('date +%s%3N'))

	// Create a file
	await uploadFile('/Home/modified-time-test/file1.txt', 'content1')

	// Get the guest's time after creating the file
	const afterCreation = Number(await umbreld.vm.ssh('date +%s%3N'))

	// Query the directory listing
	const listing = await umbreld.client.files.list.query({
		path: '/Home/modified-time-test',
	})

	// Check that the file modified time is reported correctly. The kernel
	// stamps mtimes from its coarse clock which can lag the precise clock read
	// by `date` by a tick, so allow a small tolerance on the lower bound.
	const file = listing.files.find((f) => f.name === 'file1.txt')
	expect(file).toBeDefined()
	expect(file!.modified).toBeGreaterThanOrEqual(beforeCreation - 50)
	expect(file!.modified).toBeLessThanOrEqual(afterCreation)
})
