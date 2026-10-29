import {expect, beforeAll, afterAll, test} from 'vitest'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'

let umbreld: Awaited<ReturnType<typeof createTestVm>>
let dashboardToken = ''

// Each test uses uniquely named files so no cleanup between tests is needed
beforeAll(async () => {
	umbreld = await createTestVm({device: 'umbrel-home'})
	await umbreld.vm.powerOn()
	await umbreld.signup()

	// Establish a browser session in the harness cookie jar and use its dashboard
	// credential so URL-token requests and cookies refer to the same session.
	const login = await umbreld.browserApi.post('../trpc/user.login', {json: {password: 'moneyprintergobrrr'}})
	const loginToken = (login.body as unknown as {result?: {data?: unknown}}).result?.data
	if (typeof loginToken !== 'string') throw new Error('Login did not return a dashboard credential')
	dashboardToken = loginToken
	umbreld.setAuthToken(dashboardToken)
})

afterAll(async () => {
	await umbreld.cleanup()
})

// Create a file through the files API
async function uploadFile(path: string, content: string | Buffer) {
	await umbreld.api.post(`files/upload?path=${encodeURIComponent(path)}`, {body: content})
}

test('GET /api/files/view throws unauthorized error without a credential', async () => {
	const error = await umbreld.unauthenticatedApi.get('files/view').catch((error) => error)
	expect(error).toBeInstanceOf(Error)
	expect(error.response.statusCode).toBe(401)
	expect(error.response.body).toMatchObject({error: 'unauthorized'})
})

test('GET /api/files/view throws 404 error without path parameter', async () => {
	const error = await umbreld.api.get('files/view').catch((error) => error)
	expect(error).toBeInstanceOf(Error)
	expect(error.response.statusCode).toBe(400)
	expect(error.response.body).toMatchObject({error: 'path is required'})
})

test('GET /api/files/view throws 404 error when file does not exist', async () => {
	const error = await umbreld.api.get('files/view?path=/Home/does-not-exist').catch((error) => error)
	expect(error).toBeInstanceOf(Error)
	expect(error.response.statusCode).toBe(404)
	expect(error.response.body).toMatchObject({error: 'not found'})
})

test('GET /api/files/view throws 404 error on directory traversal attempt', async () => {
	const error = await umbreld.api.get('files/view?path=/Home/../../../../etc/passwd').catch((error) => error)
	expect(error).toBeInstanceOf(Error)
	expect(error.response.statusCode).toBe(404)
	expect(error.response.body).toMatchObject({error: 'not found'})
})

test('GET /api/files/view throws 404 error on relative path', async () => {
	const paths = ['Home/file.txt', './Home/file.txt', '../home/file.txt', 'file.txt']

	for (const path of paths) {
		const error = await umbreld.api.get(`files/view?path=${path}`).catch((error) => error)
		expect(error).toBeInstanceOf(Error)
		expect(error.response.statusCode).toBe(404)
		expect(error.response.body).toMatchObject({error: 'not found'})
	}
})

test('GET /api/files/view throws 404 error on symlink traversal attempt', async () => {
	// Create a symlink to the root directory (no product surface creates
	// symlinks, so seed it over SSH)
	await umbreld.vm.ssh('ln -s / /home/umbrel/umbrel/home/view-symlink-to-root')

	// Attempt to access files through the symlink
	const error = await umbreld.api.get('files/view?path=/Home/view-symlink-to-root/etc/passwd').catch((error) => error)
	expect(error).toBeInstanceOf(Error)
	expect(error.response.statusCode).toBe(404)
	expect(error.response.body).toMatchObject({error: 'not found'})
})

test('GET /api/files/view throws 404 error when trying to view a directory', async () => {
	// Create a directory
	await umbreld.client.files.createDirectory.mutate({path: '/Home/view-test-dir'})

	// Try to view the directory
	const error = await umbreld.api.get('files/view?path=/Home/view-test-dir').catch((error) => error)
	expect(error).toBeInstanceOf(Error)
	expect(error.response.statusCode).toBe(400)
	expect(error.response.body).toMatchObject({error: 'cannot view a directory'})
})

test('GET /api/files/view rejects the dashboard credential even with the browser cookie', async () => {
	const error = await umbreld.browserApi
		.get('files/view?path=/Home/view-file.txt', {headers: {Authorization: `Bearer ${dashboardToken}`}})
		.catch((error) => error)
	expect(error.response.statusCode).toBe(401)
})

test('GET /api/files/view serves a file with the HTTP API token and browser cookie', async () => {
	// Create a file
	await uploadFile('/Home/view-file.txt', 'contents')

	// View the file
	const response = await umbreld.api.get('files/view?path=/Home/view-file.txt', {
		responseType: 'text',
	})

	// Assert the response is correct
	expect(response.statusCode).toBe(200)
	expect(response.body).toBe('contents')
	expect(response.headers['content-security-policy']).toBe(
		"sandbox; default-src 'none'; script-src 'none'; object-src 'none'; base-uri 'none'",
	)
	expect(response.headers['x-content-type-options']).toBe('nosniff')
	expect(response.headers['content-type']).toBe('text/plain')
	expect(response.headers['content-disposition']).toBeUndefined()
	// View doesn't set Content-Disposition header as it's for viewing, not downloading
})

test('GET /api/files/view requires the URL token and browser cookie from the same session', async () => {
	await uploadFile('/Home/http-api-view.txt', 'HTTP API contents')
	const path = encodeURIComponent('/Home/http-api-view.txt')
	const urlToken = await umbreld.client.user.getHttpApiToken.query()

	// A normal browser navigation carries the browser cookie retained at login and
	// the stable session token in the URL.
	const response = await umbreld.browserApi.get(`files/view?path=${path}&token=${urlToken}`, {responseType: 'text'})
	expect(response.body).toBe('HTTP API contents')

	// Neither half of the credential pair is sufficient by itself.
	const tokenOnly = await umbreld.unauthenticatedApi
		.get(`files/view?path=${path}&token=${urlToken}`)
		.catch((error) => error)
	expect(tokenOnly.response.statusCode).toBe(401)
	const cookieOnly = await umbreld.browserApi.get(`files/view?path=${path}`).catch((error) => error)
	expect(cookieOnly.response.statusCode).toBe(401)

	// A token from a second valid session cannot be combined with the first
	// session's cookie.
	const secondLogin = await umbreld.unauthenticatedApi.post('../trpc/user.login', {
		json: {password: 'moneyprintergobrrr'},
	})
	const secondDashboardToken = (secondLogin.body as unknown as {result?: {data?: unknown}}).result?.data
	const secondBrowserCookie = (secondLogin.headers['set-cookie'] ?? [])
		.find((cookie) => cookie.startsWith('UMBREL_BROWSER_SESSION='))
		?.split(';')[0]
	if (typeof secondDashboardToken !== 'string' || !secondBrowserCookie) throw new Error('Second login failed')
	const secondTokenResponse = await umbreld.unauthenticatedApi.get('../trpc/user.getHttpApiToken', {
		headers: {
			Authorization: `Bearer ${secondDashboardToken}`,
			cookie: secondBrowserCookie,
		},
	})
	const secondSessionUrlToken = (secondTokenResponse.body as unknown as {result?: {data?: unknown}}).result?.data
	if (typeof secondSessionUrlToken !== 'string') throw new Error('Second HTTP API token request failed')
	const mismatched = await umbreld.browserApi
		.get(`files/view?path=${path}&token=${secondSessionUrlToken}`)
		.catch((error) => error)
	expect(mismatched.response.statusCode).toBe(401)
})

test('GET /api/files/view forces HTML files to download', async () => {
	// Create an HTML file
	await uploadFile('/Home/poc-download.html', '<script>alert("xss")</script>')

	// View the file
	const response = await umbreld.api.get('files/view?path=/Home/poc-download.html', {
		responseType: 'text',
	})

	// Assert the response is forced to download rather than render inline
	expect(response.statusCode).toBe(200)
	expect(response.body).toBe('<script>alert("xss")</script>')
	expect(response.headers['content-security-policy']).toBe(
		"sandbox; default-src 'none'; script-src 'none'; object-src 'none'; base-uri 'none'",
	)
	expect(response.headers['x-content-type-options']).toBe('nosniff')
	expect(response.headers['content-type']).toBe('application/octet-stream')
	expect(response.headers['content-disposition']).toBe("attachment; filename*=UTF-8''poc-download.html")
})

test('GET /api/files/view forces SVG files to download', async () => {
	// Create an SVG file
	await uploadFile(
		'/Home/poc-svg-download.svg',
		'<svg xmlns="http://www.w3.org/2000/svg"><script>alert("xss")</script></svg>',
	)

	// View the file
	const response = await umbreld.api.get('files/view?path=/Home/poc-svg-download.svg', {
		responseType: 'text',
	})

	// Assert the response is forced to download rather than render inline
	expect(response.statusCode).toBe(200)
	expect(response.body).toBe('<svg xmlns="http://www.w3.org/2000/svg"><script>alert("xss")</script></svg>')
	expect(response.headers['content-security-policy']).toBe(
		"sandbox; default-src 'none'; script-src 'none'; object-src 'none'; base-uri 'none'",
	)
	expect(response.headers['x-content-type-options']).toBe('nosniff')
	expect(response.headers['content-type']).toBe('application/octet-stream')
	expect(response.headers['content-disposition']).toBe("attachment; filename*=UTF-8''poc-svg-download.svg")
})

test('GET /api/files/view serves SVG files inline for image embeds', async () => {
	// Create an SVG file
	await uploadFile(
		'/Home/poc-svg-inline.svg',
		'<svg xmlns="http://www.w3.org/2000/svg"><script>alert("xss")</script></svg>',
	)

	// View the file as an embedded image
	const response = await umbreld.api.get('files/view?path=/Home/poc-svg-inline.svg', {
		responseType: 'text',
		headers: {'Sec-Fetch-Dest': 'image'},
	})

	// Assert the response can render in an <img>, with CSP and nosniff still applied
	expect(response.statusCode).toBe(200)
	expect(response.body).toBe('<svg xmlns="http://www.w3.org/2000/svg"><script>alert("xss")</script></svg>')
	expect(response.headers['content-security-policy']).toBe(
		"sandbox; default-src 'none'; script-src 'none'; object-src 'none'; base-uri 'none'",
	)
	expect(response.headers['x-content-type-options']).toBe('nosniff')
	expect(response.headers['content-type']).toBe('image/svg+xml')
	expect(response.headers['content-disposition']).toBeUndefined()
})

test('GET /api/files/view serves SVG files inline for image accepts without fetch metadata', async () => {
	// Create an SVG file
	await uploadFile(
		'/Home/poc-svg-accept.svg',
		'<svg xmlns="http://www.w3.org/2000/svg"><script>alert("xss")</script></svg>',
	)

	// View the file as an embedded image from browsers that don't send Sec-Fetch-Dest on local HTTP origins
	const response = await umbreld.api.get('files/view?path=/Home/poc-svg-accept.svg', {
		responseType: 'text',
		headers: {Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'},
	})

	// Assert the response can render in an <img>, with CSP and nosniff still applied
	expect(response.statusCode).toBe(200)
	expect(response.body).toBe('<svg xmlns="http://www.w3.org/2000/svg"><script>alert("xss")</script></svg>')
	expect(response.headers['content-security-policy']).toBe(
		"sandbox; default-src 'none'; script-src 'none'; object-src 'none'; base-uri 'none'",
	)
	expect(response.headers['x-content-type-options']).toBe('nosniff')
	expect(response.headers['content-type']).toBe('image/svg+xml')
	expect(response.headers['content-disposition']).toBeUndefined()
})

test('GET /api/files/view handles files with special characters in name', async () => {
	// Create a file with special characters in the name
	const fileName = 'file with spaces & special chars 漢字.txt'
	await uploadFile(`/Home/${fileName}`, 'special contents')

	// View the file
	const response = await umbreld.api.get(`files/view?path=/Home/${encodeURIComponent(fileName)}`, {
		responseType: 'text',
	})

	// Assert the response is correct
	expect(response.statusCode).toBe(200)
	expect(response.body).toBe('special contents')
})

test('GET /api/files/view handles files with URL-encoded characters in path', async () => {
	// Create a file with characters that need URL encoding
	const filename = 'file+with?query&params.txt'
	await uploadFile(`/Home/${filename}`, 'url encoded content')

	// View the file using URL encoded path
	const response = await umbreld.api.get(`files/view?path=/Home/${encodeURIComponent(filename)}`, {
		responseType: 'text',
	})

	// Assert the response is correct
	expect(response.statusCode).toBe(200)
	expect(response.body).toBe('url encoded content')
})

test('GET /api/files/view handles files with zero content correctly', async () => {
	// Create an empty file
	await uploadFile('/Home/empty-file.txt', '')

	// View the file
	const response = await umbreld.api.get('files/view?path=/Home/empty-file.txt', {
		responseType: 'text',
	})

	// Assert the response is correct
	expect(response.statusCode).toBe(200)
	expect(response.body).toBe('')
})

test('GET /api/files/view handles binary files correctly', async () => {
	// Create a small binary file
	const binaryData = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe, 0xfd, 0xfc])
	await uploadFile('/Home/binary-file.bin', binaryData)

	// View the file
	const response = await umbreld.api.get('files/view?path=/Home/binary-file.bin', {
		responseType: 'buffer',
	})

	// Assert the response is correct
	expect(response.statusCode).toBe(200)
	expect(Buffer.from(response.body)).toEqual(binaryData)
})

test('GET /api/files/view sends the file revision as a strong ETag', async () => {
	// Create a file
	await uploadFile('/Home/view-revision.txt', 'first')
	const view = (headers: Record<string, string> = {}) =>
		umbreld.api.get('files/view?path=/Home/view-revision.txt', {responseType: 'text', headers})

	// The ETag is the strong revision: inode, size, and modification and change times
	const first = await view()
	expect(first.headers.etag).toMatch(/^"\d+-5-\d+-\d+"$/)

	// Revalidating with it answers 304 without a body
	const revalidated = await view({'If-None-Match': first.headers.etag!})
	expect(revalidated.statusCode).toBe(304)
	expect(revalidated.body).toBe('')

	// Range requests validated against it still get partial content
	const range = await view({Range: 'bytes=1-3', 'If-Range': first.headers.etag!})
	expect(range.statusCode).toBe(206)
	expect(range.body).toBe('irs')

	// Replacing the file moves it to the revision the upload answered
	const replaced = await umbreld.api.post('files/upload?path=/Home/view-revision.txt&collision=replace', {
		body: 'second',
	})
	const second = await view({'If-None-Match': first.headers.etag!})
	expect(second.statusCode).toBe(200)
	expect(second.body).toBe('second')
	expect(second.headers.etag).toBe(`"${(replaced.body as unknown as {revision: string}).revision}"`)

	// Writing in place, as an SMB client or app would, moves it too (seeded over
	// SSH: no product surface writes in place)
	await umbreld.vm.ssh(`printf ' edit' >> '/home/umbrel/umbrel/home/view-revision.txt'`)
	const third = await view({'If-None-Match': second.headers.etag!})
	expect(third.statusCode).toBe(200)
	expect(third.body).toBe('second edit')
	expect(third.headers.etag).toMatch(/^"\d+-11-\d+-\d+"$/)
})
