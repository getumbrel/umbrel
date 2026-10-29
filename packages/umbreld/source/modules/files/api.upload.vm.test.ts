import {once} from 'node:events'
import {Readable} from 'node:stream'

import {expect, beforeAll, afterAll, test} from 'vitest'
import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'

// The entire upload API runs end-to-end here, including the disk-full write
// error case which is triggered by genuinely filling a filesystem (a tiny
// tmpfs mount) rather than mocking the server's write stream.

let umbreld: Awaited<ReturnType<typeof createTestVm>>

// Each test uses uniquely named files so no cleanup between tests is needed
beforeAll(async () => {
	umbreld = await createTestVm({device: 'umbrel-home'})
	await umbreld.vm.powerOn()
	await umbreld.registerAndLogin()
})

afterAll(async () => {
	await umbreld.cleanup()
})

const guestHome = '/home/umbrel/umbrel/home'

// Read a file's content from inside the VM (low-level assertion via SSH)
async function readGuestFile(guestPath: string) {
	return umbreld.vm.ssh(`cat '${guestPath}'`)
}

// Check a path exists inside the VM. The ssh helper ignores exit codes so we
// echo a marker instead.
async function guestPathExists(guestPath: string) {
	const output = await umbreld.vm.ssh(`test -e '${guestPath}' && echo exists || echo missing`)
	return output.trim() === 'exists'
}

async function guestUploadTemporaryFiles(directory: string, fileName: string) {
	const output = await umbreld.vm.ssh(`find '${directory}' -maxdepth 1 -name '.${fileName}.*.umbrel-upload' -print`)
	return output.trim() ? output.trim().split('\n') : []
}

test('POST /api/files/upload throws unauthorized error without a bearer credential', async () => {
	const error = await umbreld.unauthenticatedApi
		.post('files/upload?path=/Home/test-file.txt', {body: 'test content'})
		.catch((error) => error)
	expect(error).toBeInstanceOf(Error)
	expect(error.response.statusCode).toBe(401)
	expect(error.response.body).toMatchObject({error: 'unauthorized'})
})

test('POST /api/files/upload rejects the dashboard credential without its browser cookie', async () => {
	const login = await umbreld.unauthenticatedApi.post('../trpc/user.login', {
		json: {password: 'moneyprintergobrrr'},
	})
	const dashboardToken = (login.body as unknown as {result?: {data?: unknown}}).result?.data
	if (typeof dashboardToken !== 'string') throw new Error('Login did not return a dashboard credential')

	const error = await umbreld.unauthenticatedApi
		.post('files/upload?path=/Home/token-only-must-not-upload.txt', {
			body: 'test content',
			headers: {Authorization: `Bearer ${dashboardToken}`},
		})
		.catch((error) => error)
	expect(error.response.statusCode).toBe(401)
	await expect(guestPathExists(`${guestHome}/token-only-must-not-upload.txt`)).resolves.toBe(false)
})

test('POST /api/files/upload rejects the browser cookie without its dashboard credential', async () => {
	const error = await umbreld.browserApi
		.post('files/upload?path=/Home/cookie-only-must-not-upload.txt', {body: 'test content'})
		.catch((error) => error)
	expect(error.response.statusCode).toBe(401)
	await expect(guestPathExists(`${guestHome}/cookie-only-must-not-upload.txt`)).resolves.toBe(false)
})

test('POST /api/files/upload does not accept the app-session cookie', async () => {
	const login = await umbreld.unauthenticatedApi.post('../trpc/user.login', {
		json: {password: 'moneyprintergobrrr'},
	})
	const appSession = (login.headers['set-cookie'] ?? [])
		.find((cookie) => cookie.startsWith('UMBREL_APP_SESSION='))
		?.split(';')[0]
	expect(appSession).toBeDefined()

	const error = await umbreld.unauthenticatedApi
		.post('files/upload?path=/Home/app-cookie-must-not-upload.txt', {
			body: 'test content',
			headers: {cookie: appSession!},
		})
		.catch((error) => error)
	expect(error.response.statusCode).toBe(401)
	await expect(guestPathExists(`${guestHome}/app-cookie-must-not-upload.txt`)).resolves.toBe(false)
})

test('POST /api/files/upload throws 400 error without path parameter', async () => {
	const error = await umbreld.api.post('files/upload', {body: 'test content'}).catch((error) => error)
	expect(error).toBeInstanceOf(Error)
	expect(error.response.statusCode).toBe(400)
	expect(error.response.body).toMatchObject({error: 'path is required'})
})

test('POST /api/files/upload throws 400 error on directory traversal attempt', async () => {
	const error = await umbreld.api
		.post('files/upload?path=/Home/../../../../etc/dangerous-file.txt', {body: 'malicious content'})
		.catch((error) => error)
	expect(error).toBeInstanceOf(Error)
	expect(error.response.statusCode).toBe(400)
	expect(error.response.body).toMatchObject({error: 'invalid path'})
})

test('POST /api/files/upload throws 400 error on relative path', async () => {
	const paths = ['Home/file.txt', './Home/file.txt', '../home/file.txt', 'file.txt']

	for (const path of paths) {
		const error = await umbreld.api.post(`files/upload?path=${path}`, {body: 'test content'}).catch((error) => error)
		expect(error).toBeInstanceOf(Error)
		expect(error.response.statusCode).toBe(400)
		expect(error.response.body).toMatchObject({error: 'invalid path'})
	}
})

test('POST /api/files/upload throws 400 error on symlink traversal attempt', async () => {
	// Create a symlink to the root directory (no product surface creates
	// symlinks, so seed it over SSH)
	await umbreld.vm.ssh(`ln -s / ${guestHome}/upload-symlink-to-root`)

	// Attempt to upload a file through the symlink
	const error = await umbreld.api
		.post('files/upload?path=/Home/upload-symlink-to-root/etc/dangerous-file.txt', {body: 'malicious content'})
		.catch((error) => error)
	expect(error).toBeInstanceOf(Error)
	expect(error.response.statusCode).toBe(400)
	expect(error.response.body).toMatchObject({error: 'invalid path'})
})

test('POST /api/files/upload succeeds with matching dashboard and browser credentials', async () => {
	// Upload a file
	const response = await umbreld.api.post('files/upload?path=/Home/new-file.txt', {
		body: 'uploaded content',
	})

	// Assert the response is correct
	expect(response.statusCode).toBe(200)
	expect(response.body).toEqual({path: '/Home/new-file.txt', revision: expect.stringMatching(/^\d+-16-\d+-\d+$/)})

	// Verify the file was created with the right content
	await expect(readGuestFile(`${guestHome}/new-file.txt`)).resolves.toBe('uploaded content')
})

test('POST /api/files/upload creates parent directories if they do not exist', async () => {
	// Upload a file to a path with non-existent directories
	const response = await umbreld.api.post('files/upload?path=/Home/new-dir/sub-dir/new-file.txt', {
		body: 'nested content',
	})

	// Assert the response is correct
	expect(response.statusCode).toBe(200)

	// Verify the directories and file were created with the right content
	await expect(readGuestFile(`${guestHome}/new-dir/sub-dir/new-file.txt`)).resolves.toBe('nested content')
})

test('POST /api/files/upload handles files with special characters in name', async () => {
	// File name with special characters
	const fileName = 'file with spaces & special chars 漢字.txt'

	// Upload the file
	const response = await umbreld.api.post(`files/upload?path=/Home/${encodeURIComponent(fileName)}`, {
		body: 'special content',
	})

	// Assert the response is correct
	expect(response.statusCode).toBe(200)

	// Verify the file was created with the right content
	await expect(readGuestFile(`${guestHome}/${fileName}`)).resolves.toBe('special content')
})

test('POST /api/files/upload handles files with URL-encoded characters in path', async () => {
	// File name with characters that need URL encoding
	const filename = 'file+with?query&params.txt'

	// Upload the file
	const response = await umbreld.api.post(`files/upload?path=/Home/${encodeURIComponent(filename)}`, {
		body: 'url encoded content',
	})

	// Assert the response is correct
	expect(response.statusCode).toBe(200)

	// Verify the file was created with the right content
	await expect(readGuestFile(`${guestHome}/${filename}`)).resolves.toBe('url encoded content')
})

test('POST /api/files/upload handles empty files correctly', async () => {
	// Upload an empty file
	const response = await umbreld.api.post('files/upload?path=/Home/empty-file-upload.txt', {body: ''})

	// Assert the response is correct
	expect(response.statusCode).toBe(200)

	// Verify the file was created and is empty
	await expect(guestPathExists(`${guestHome}/empty-file-upload.txt`)).resolves.toBe(true)
	await expect(readGuestFile(`${guestHome}/empty-file-upload.txt`)).resolves.toBe('')
})

test('POST /api/files/upload handles binary data correctly', async () => {
	// Binary data as base64
	const binaryData = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe, 0xfd, 0xfc]).toString('base64')

	// Upload binary file
	const response = await umbreld.api.post('files/upload?path=/Home/binary-upload.bin', {
		body: binaryData,
	})

	// Assert the response is correct
	expect(response.statusCode).toBe(200)

	// Verify the content round-trips
	await expect(readGuestFile(`${guestHome}/binary-upload.bin`)).resolves.toBe(binaryData)
})

test('POST /api/files/upload creates file with correct permissions', async () => {
	// Upload a file
	const response = await umbreld.api.post('files/upload?path=/Home/permissions-upload.txt', {
		body: 'permissions content',
	})

	// Assert the response is correct
	expect(response.statusCode).toBe(200)

	// Check ownership is the umbrel user and group, and only they can access it
	// (low-level OS fact via SSH)
	const stat = await umbreld.vm.ssh(`stat --format '%u %g %a' ${guestHome}/permissions-upload.txt`)
	expect(stat.trim()).toBe('1000 1000 600')
})

test('POST /api/files/upload correctly handles streaming data in chunks', async () => {
	// Test file path
	const filePath = '/Home/streaming-test.txt'
	const systemPath = `${guestHome}/streaming-test.txt`

	// Get a stream for the request
	const uploadStream = umbreld.api.stream.post(`files/upload?path=${filePath}`)

	try {
		// Check file doesn't yet exist
		await expect(guestPathExists(systemPath)).resolves.toBe(false)
		await expect(guestUploadTemporaryFiles(guestHome, 'streaming-test.txt')).resolves.toStrictEqual([])

		// Chunks of data to pipe to the upload stream
		const chunks = [
			Buffer.from('First chunk of data - '),
			Buffer.from('Second chunk of data - '),
			Buffer.from('Third chunk of data - '),
		]
		let temporarySystemPath = ''

		for (const [index, chunk] of chunks.entries()) {
			// Write the chunk to the upload stream
			uploadStream.write(chunk)

			// Discover the randomized staging path. Its contents are deliberately
			// root-only, so inspect them with one privileged command rather than
			// putting a potentially slow SSH handshake inside a short poll timeout.
			if (!temporarySystemPath) {
				await pWaitFor(
					async () => {
						const temporaryFiles = await guestUploadTemporaryFiles(guestHome, 'streaming-test.txt')
						if (temporaryFiles.length !== 1) return false
						temporarySystemPath = temporaryFiles[0]!
						return true
					},
					{interval: 500, timeout: 60_000},
				)
			}

			const expectedContent = Buffer.concat(chunks.slice(0, index + 1)).toString()
			const stagedContentBase64 = await umbreld.vm.sshAsRoot(`
for attempt in $(seq 1 100); do
	if [ "$(stat --format '%s' '${temporarySystemPath}')" -ge ${Buffer.byteLength(expectedContent)} ]; then
		base64 -w0 '${temporarySystemPath}'
		exit 0
	fi
	sleep 0.1
done
exit 1
`)
			expect(Buffer.from(stagedContentBase64, 'base64').toString()).toBe(expectedContent)

			if (index === 0) {
				const mode = await umbreld.vm.sshAsRoot(`stat --format '%a' '${temporarySystemPath}'`)
				expect(mode).toBe('600')
			}

			// Check the final file still doesn't exist while the upload is in progress
			await expect(guestPathExists(systemPath)).resolves.toBe(false)
		}

		// End the stream
		uploadStream.end()

		// Check response is ok
		const [response] = await once(uploadStream, 'response')
		expect(response.statusCode).toBe(200)

		// Check if the file was moved to the final path
		await pWaitFor(async () => guestPathExists(systemPath), {interval: 500, timeout: 60_000})
		await expect(guestUploadTemporaryFiles(guestHome, 'streaming-test.txt')).resolves.toStrictEqual([])

		// Check the content of the final file
		await expect(readGuestFile(systemPath)).resolves.toBe(chunks.join(''))
	} finally {
		if (!uploadStream.destroyed) uploadStream.destroy()
	}
})

test('POST /api/files/upload cleans up temporary files when client aborts partially uploaded file', async () => {
	// Test file path
	const filePath = '/Home/aborted-upload.txt'
	const systemPath = `${guestHome}/aborted-upload.txt`

	// Get a stream for the request
	const uploadStream = umbreld.api.stream.post(`files/upload?path=${filePath}`)

	// Check files don't exist yet
	await expect(guestPathExists(systemPath)).resolves.toBe(false)
	await expect(guestUploadTemporaryFiles(guestHome, 'aborted-upload.txt')).resolves.toStrictEqual([])

	// Write the chunk to the upload stream
	uploadStream.write(Buffer.from('First chunk'))

	// Wait for the temporary file to be created
	await pWaitFor(async () => (await guestUploadTemporaryFiles(guestHome, 'aborted-upload.txt')).length === 1, {
		interval: 500,
		timeout: 60_000,
	})
	await expect(guestPathExists(systemPath)).resolves.toBe(false)

	// Now abort the request
	uploadStream.destroy()

	// Wait for the backend to clean up the partially uploaded temporary file
	await pWaitFor(async () => (await guestUploadTemporaryFiles(guestHome, 'aborted-upload.txt')).length === 0, {
		interval: 500,
		timeout: 60_000,
	})
	await expect(guestPathExists(systemPath)).resolves.toBe(false)
})

test('POST /api/files/upload handles disk full write errors correctly', {retry: 5}, async () => {
	// Mount a tiny tmpfs so writing the uploaded file genuinely fails with
	// ENOSPC, exercising the server's write error path with a real full disk
	const guestDirectory = `${guestHome}/disk-full-test`
	await umbreld.vm.sshAsRoot(`mkdir -p '${guestDirectory}' && mount -t tmpfs -o size=1m tmpfs '${guestDirectory}'`)

	try {
		// Upload a file slightly larger than the filesystem so the request body
		// is fully received before the final write fails
		const error = await umbreld.api
			.post('files/upload?path=/Home/disk-full-test/should-fail.bin', {body: Buffer.alloc(1024 * 1024 + 8 * 1024)})
			.catch((error) => error)

		// Verify the error response
		expect(error).toBeInstanceOf(Error)
		expect(error.response.statusCode).toBe(500)
		expect(error.response.body).toMatchObject({error: 'error writing file'})

		// Verify the partially written temporary file was cleaned up and the
		// final file was never created
		await pWaitFor(async () => (await guestUploadTemporaryFiles(guestDirectory, 'should-fail.bin')).length === 0, {
			interval: 500,
			timeout: 60_000,
		})
		await expect(guestPathExists(`${guestDirectory}/should-fail.bin`)).resolves.toBe(false)
	} finally {
		// Remove the tmpfs mount
		await umbreld.vm.sshAsRoot(`umount '${guestDirectory}' && rmdir '${guestDirectory}'`)
	}
})

test('POST /api/files/upload rejects an upload that cannot fit with 507 before writing', async () => {
	// A declared size no disk can hold triggers the preflight. The body is a
	// stream so the client sends the declared Content-Length header as-is instead
	// of computing one.
	const error = await umbreld.api
		.post('files/upload?path=/Home/preflight-should-fail.bin', {
			body: Readable.from([Buffer.alloc(1024)]),
			headers: {'content-length': String(500 * 1024 ** 4)},
		})
		.catch((error) => error)

	expect(error).toBeInstanceOf(Error)
	expect(error.response.statusCode).toBe(507)
	expect(error.response.body).toMatchObject({error: '[not-enough-space]'})

	// The rejection happened before any bytes were written: no destination file
	// and no temporary file
	await expect(guestPathExists(`${guestHome}/preflight-should-fail.bin`)).resolves.toBe(false)
	await expect(guestUploadTemporaryFiles(guestHome, 'preflight-should-fail.bin')).resolves.toEqual([])
})

test('POST /api/files/upload with collision=error (default) throws 400 when file already exists', async () => {
	// Create a file through the upload API
	await umbreld.api.post('files/upload?path=/Home/collision-test.txt', {body: 'original content'})

	// Try to upload to the same path
	const error = await umbreld.api
		.post('files/upload?path=/Home/collision-test.txt', {body: 'new content'})
		.catch((error) => error)
	expect(error).toBeInstanceOf(Error)
	expect(error.response.statusCode).toBe(400)
	expect(error.response.body).toMatchObject({error: '[destination-already-exists]'})

	// Verify the file wasn't changed
	await expect(readGuestFile(`${guestHome}/collision-test.txt`)).resolves.toBe('original content')
})

test('POST /api/files/upload with collision=error throws 400 when explicitly set and file already exists', async () => {
	// Create a file through the upload API
	await umbreld.api.post('files/upload?path=/Home/explicit-error-test.txt', {body: 'original content'})

	// Try to upload to the same path with explicit error strategy
	const error = await umbreld.api
		.post('files/upload?path=/Home/explicit-error-test.txt&collision=error', {body: 'new content'})
		.catch((error) => error)
	expect(error).toBeInstanceOf(Error)
	expect(error.response.statusCode).toBe(400)
	expect(error.response.body).toMatchObject({error: '[destination-already-exists]'})

	// Verify the file wasn't changed
	await expect(readGuestFile(`${guestHome}/explicit-error-test.txt`)).resolves.toBe('original content')
})

test('POST /api/files/upload with collision=keep-both creates uniquely named file when file already exists', async () => {
	// Create a file through the upload API
	await umbreld.api.post('files/upload?path=/Home/keep-both-test.txt', {body: 'original content'})

	// Upload to the same path with keep-both strategy
	const response = await umbreld.api.post('files/upload?path=/Home/keep-both-test.txt&collision=keep-both', {
		body: 'new content',
	})

	// Assert the response is correct
	expect(response.statusCode).toBe(200)
	expect(response.body).toEqual({
		path: '/Home/keep-both-test (2).txt',
		revision: expect.stringMatching(/^\d+-11-\d+-\d+$/),
	})

	// Verify both files exist with correct content
	await expect(readGuestFile(`${guestHome}/keep-both-test.txt`)).resolves.toBe('original content')
	await expect(readGuestFile(`${guestHome}/keep-both-test (2).txt`)).resolves.toBe('new content')
})

test('POST /api/files/upload atomically keeps both concurrent same-name uploads', async () => {
	const [first, second] = await Promise.all([
		umbreld.api.post('files/upload?path=/Home/concurrent-keep-both.txt&collision=keep-both', {body: 'first'}),
		umbreld.api.post('files/upload?path=/Home/concurrent-keep-both.txt&collision=keep-both', {body: 'second'}),
	])
	const paths = [(first.body as unknown as {path: string}).path, (second.body as unknown as {path: string}).path].sort()
	expect(paths).toEqual(['/Home/concurrent-keep-both (2).txt', '/Home/concurrent-keep-both.txt'])
	await expect(
		Promise.all(paths.map((path) => readGuestFile(`${guestHome}/${path.slice('/Home/'.length)}`))),
	).resolves.toEqual(expect.arrayContaining(['first', 'second']))
})

test('POST /api/files/upload with collision=keep-both increments number for multiple collisions', async () => {
	// Create a file and its first duplicate through the upload API
	await umbreld.api.post('files/upload?path=/Home/multiple-test.txt', {body: 'original content'})
	await umbreld.api.post(`files/upload?path=${encodeURIComponent('/Home/multiple-test (2).txt')}`, {
		body: 'first duplicate',
	})

	// Upload to the same path with keep-both strategy
	const response = await umbreld.api.post('files/upload?path=/Home/multiple-test.txt&collision=keep-both', {
		body: 'second duplicate',
	})

	// Assert the response is correct
	expect(response.statusCode).toBe(200)
	expect(response.body).toEqual({
		path: '/Home/multiple-test (3).txt',
		revision: expect.stringMatching(/^\d+-16-\d+-\d+$/),
	})

	// Verify all files exist with correct content
	await expect(readGuestFile(`${guestHome}/multiple-test.txt`)).resolves.toBe('original content')
	await expect(readGuestFile(`${guestHome}/multiple-test (2).txt`)).resolves.toBe('first duplicate')
	await expect(readGuestFile(`${guestHome}/multiple-test (3).txt`)).resolves.toBe('second duplicate')
})

test('POST /api/files/upload with collision=replace overwrites existing file', async () => {
	// Create a file through the upload API
	await umbreld.api.post('files/upload?path=/Home/replace-test.txt', {body: 'original content'})

	// Upload to the same path with replace strategy
	const response = await umbreld.api.post('files/upload?path=/Home/replace-test.txt&collision=replace', {
		body: 'replacement content',
	})

	// Assert the response is correct
	expect(response.statusCode).toBe(200)
	expect(response.body).toEqual({path: '/Home/replace-test.txt', revision: expect.stringMatching(/^\d+-19-\d+-\d+$/)})

	// Verify file exists with new content
	await expect(readGuestFile(`${guestHome}/replace-test.txt`)).resolves.toBe('replacement content')
})

test('POST /api/files/upload with collision=replace keeps the replaced file permissions and owner', async () => {
	// A file owned by someone else, readable by others and setuid (seeded over
	// SSH: no product surface sets owners or modes)
	await umbreld.api.post('files/upload?path=/Home/replace-keeps-mode.sh', {body: 'echo original'})
	await umbreld.vm.sshAsRoot(
		`chown 1234:1234 '${guestHome}/replace-keeps-mode.sh' && chmod 4754 '${guestHome}/replace-keeps-mode.sh'`,
	)

	// Replace it
	const response = await umbreld.api.post('files/upload?path=/Home/replace-keeps-mode.sh&collision=replace', {
		body: 'echo edited',
	})
	expect(response.statusCode).toBe(200)

	// The owner and permission bits carry over, but setuid does not
	const stat = await umbreld.vm.ssh(`stat --format '%u %g %a' '${guestHome}/replace-keeps-mode.sh'`)
	expect(stat.trim()).toBe('1234 1234 754')
	await expect(readGuestFile(`${guestHome}/replace-keeps-mode.sh`)).resolves.toBe('echo edited')
})

test('POST /api/files/upload with collision=replace saves over the revision named by If-Match', async () => {
	// Create a file and read its revision the way the file viewer does
	await umbreld.api.post('files/upload?path=/Home/if-match.txt', {body: 'original'})
	const view = await umbreld.api.get('files/view?path=/Home/if-match.txt', {responseType: 'text'})

	// Save over it with that revision
	const saved = await umbreld.api.post('files/upload?path=/Home/if-match.txt&collision=replace', {
		body: 'first edit',
		headers: {'If-Match': view.headers.etag},
	})
	expect(saved.statusCode).toBe(200)
	expect(saved.body).toEqual({path: '/Home/if-match.txt', revision: expect.stringMatching(/^\d+-10-\d+-\d+$/)})
	expect(saved.headers.etag).toBe(`"${(saved.body as unknown as {revision: string}).revision}"`)
	await expect(readGuestFile(`${guestHome}/if-match.txt`)).resolves.toBe('first edit')

	// The answered revision is current, so the next save can name it
	const savedAgain = await umbreld.api.post('files/upload?path=/Home/if-match.txt&collision=replace', {
		body: 'second edit',
		headers: {'If-Match': saved.headers.etag},
	})
	expect(savedAgain.statusCode).toBe(200)
	await expect(readGuestFile(`${guestHome}/if-match.txt`)).resolves.toBe('second edit')
})

test('POST /api/files/upload refuses a stale If-Match revision with 412 before staging the body', async () => {
	// Read a file's revision, then change the file in place as an SMB client or
	// app would (seeded over SSH: no product surface writes in place)
	await umbreld.api.post('files/upload?path=/Home/stale-if-match.txt', {body: 'original'})
	const view = await umbreld.api.get('files/view?path=/Home/stale-if-match.txt', {responseType: 'text'})
	await umbreld.vm.ssh(`printf ' changed elsewhere' >> '${guestHome}/stale-if-match.txt'`)

	// Saving with the stale revision is refused
	const error = await umbreld.api
		.post('files/upload?path=/Home/stale-if-match.txt&collision=replace', {
			body: 'my edit',
			headers: {'If-Match': view.headers.etag},
		})
		.catch((error) => error)
	expect(error.response.statusCode).toBe(412)
	expect(error.response.headers.connection).toBe('close')
	expect(error.response.body).toEqual({error: '[revision-mismatch]'})

	// The other change survives and nothing was staged
	await expect(readGuestFile(`${guestHome}/stale-if-match.txt`)).resolves.toBe('original changed elsewhere')
	await expect(guestUploadTemporaryFiles(guestHome, 'stale-if-match.txt')).resolves.toEqual([])
})

test('POST /api/files/upload refuses If-Match for a file that does not exist', async () => {
	for (const ifMatch of ['"1-7-1"', '*']) {
		const error = await umbreld.api
			.post('files/upload?path=/Home/if-match-missing.txt&collision=replace', {
				body: 'my edit',
				headers: {'If-Match': ifMatch},
			})
			.catch((error) => error)
		expect(error.response.statusCode).toBe(412)
		expect(error.response.body).toEqual({error: '[revision-mismatch]'})
	}
	await expect(guestPathExists(`${guestHome}/if-match-missing.txt`)).resolves.toBe(false)
})

test('POST /api/files/upload checks If-Match again once the body has arrived', async () => {
	// Start saving with the current revision
	await umbreld.api.post('files/upload?path=/Home/if-match-race.txt', {body: 'original'})
	const view = await umbreld.api.get('files/view?path=/Home/if-match-race.txt', {responseType: 'text'})
	const uploadStream = umbreld.api.stream.post('files/upload?path=/Home/if-match-race.txt&collision=replace', {
		headers: {'If-Match': view.headers.etag},
		throwHttpErrors: false,
	})

	try {
		// Another save lands while this body is still being staged
		uploadStream.write(Buffer.from('my edit'))
		await pWaitFor(async () => (await guestUploadTemporaryFiles(guestHome, 'if-match-race.txt')).length === 1, {
			interval: 500,
			timeout: 60_000,
		})
		await umbreld.api.post('files/upload?path=/Home/if-match-race.txt&collision=replace', {body: 'their edit'})

		// Finishing the stale save is refused without publishing it
		uploadStream.end()
		const [response] = await once(uploadStream, 'response')
		expect(response.statusCode).toBe(412)
		await expect(readGuestFile(`${guestHome}/if-match-race.txt`)).resolves.toBe('their edit')
		await pWaitFor(async () => (await guestUploadTemporaryFiles(guestHome, 'if-match-race.txt')).length === 0, {
			interval: 500,
			timeout: 60_000,
		})
	} finally {
		if (!uploadStream.destroyed) uploadStream.destroy()
	}
})

test('POST /api/files/upload refuses If-Match with collision modes that never overwrite', async () => {
	await umbreld.api.post('files/upload?path=/Home/if-match-copy.txt', {body: 'original'})
	const view = await umbreld.api.get('files/view?path=/Home/if-match-copy.txt', {responseType: 'text'})

	for (const collision of ['error', 'keep-both']) {
		const error = await umbreld.api
			.post(`files/upload?path=/Home/if-match-copy.txt&collision=${collision}`, {
				body: 'copy',
				headers: {'If-Match': view.headers.etag},
			})
			.catch((error) => error)
		expect(error.response.statusCode).toBe(400)
		expect(error.response.body).toEqual({error: 'If-Match requires collision=replace'})
	}
	await expect(guestPathExists(`${guestHome}/if-match-copy (2).txt`)).resolves.toBe(false)
})

test('POST /api/files/upload with invalid collision parameter returns 400 error', async () => {
	const error = await umbreld.api
		.post('files/upload?path=/Home/invalid-collision-test.txt&collision=invalid', {body: 'test content'})
		.catch((error) => error)
	expect(error).toBeInstanceOf(Error)
	expect(error.response.statusCode).toBe(400)
	expect(error.response.body).toMatchObject({error: 'invalid collision parameter'})
})
