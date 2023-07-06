import test from 'ava'
import got from 'got'
import {CookieJar} from 'tough-cookie'
import mockDate from 'mockdate'

import Umbreld from '../../source/index.js'

import temporaryDirectory from '../../test/helpers/temporary-directory.js'

const directory = temporaryDirectory('auth')

const createUmbreld = async () => {
	const dataDirectory = await directory.create()
	const umbreld = new Umbreld({
		dataDirectory,
		port: 0,
		logLevel: 'silent',
	})
	await umbreld.start()

	return umbreld
}

const getAddress = (umbreld, endpoint) => {
	const port = umbreld.services.server.port

	return `http://localhost:${port}${endpoint}`
}

const cookieJar = new CookieJar()
const http = got.extend({cookieJar})

const getCookie = async () => {
	const cookies = await cookieJar.getCookies('http://localhost')
	const cookie = cookies.find((cookie) => cookie.key === 'umbrel-session')

	return cookie
}

const testUserCredentials = {
	username: 'satoshi',
	password: 'moneyprintergobrrr',
}

test.before(async (t) => {
	await directory.createRoot()
	t.context.umbreld = await createUmbreld()
})
test.after.always(directory.destroyRoot)

test.serial('/api/login returns 401 if no user has registered yet', async (t) => {
	const {umbreld} = t.context

	const {password} = testUserCredentials
	const error = await t.throwsAsync(
		got.post(getAddress(umbreld, '/api/login'), {
			json: {password},
		}),
	)
	t.is(error.response.statusCode, 401)
	t.regex(error.response.body, /Invalid login/)
})

test.serial('/api/register adds a user to the config', async (t) => {
	const {umbreld} = t.context

	const response = await http.post(getAddress(umbreld, '/api/register'), {
		json: testUserCredentials,
	})
	t.is(response.statusCode, 200)
})

test.serial('/api/register returns 500 if username is not supplied', async (t) => {
	const {umbreld} = t.context

	const {password} = testUserCredentials
	const error = await t.throwsAsync(
		got.post(getAddress(umbreld, '/api/register'), {
			json: {password},
		}),
	)
	t.is(error.response.statusCode, 500)
	t.regex(error.response.body, /username.*undefined/)
})

test.serial('/api/register returns 500 if password is not supplied', async (t) => {
	const {umbreld} = t.context

	const {username} = testUserCredentials
	const error = await t.throwsAsync(
		got.post(getAddress(umbreld, '/api/register'), {
			json: {username},
		}),
	)
	t.is(error.response.statusCode, 500)
	t.regex(error.response.body, /password.*undefined/)
})

test.serial('/api/register returns 500 if password is below minimum length', async (t) => {
	const {umbreld} = t.context

	const {username} = testUserCredentials
	const error = await t.throwsAsync(
		got.post(getAddress(umbreld, '/api/register'), {
			json: {
				username,
				password: 'rekt',
			},
		}),
	)
	t.is(error.response.statusCode, 500)
	t.regex(error.response.body, /password.*minimum length/)
})

test.serial('/api/register returns 401 if the user is already registered', async (t) => {
	const {umbreld} = t.context

	const error = await t.throwsAsync(() =>
		http.post(getAddress(umbreld, '/api/register'), {
			json: testUserCredentials,
		}),
	)
	t.is(error.response.statusCode, 401)
	t.regex(error.response.body, /Attempted to register when user is already registered/)
})

test.serial('/api/login returns 401 for invalid credentials', async (t) => {
	const {umbreld} = t.context

	const error = await t.throwsAsync(
		got.post(getAddress(umbreld, '/api/login'), {
			json: {password: 'usdtothemoon'},
		}),
	)
	t.is(error.response.statusCode, 401)
	t.regex(error.response.body, /Invalid login/)
})

test.serial('/api/login returns 500 if password is not supplied', async (t) => {
	const {umbreld} = t.context

	const error = await t.throwsAsync(
		got.post(getAddress(umbreld, '/api/login'), {
			json: {},
		}),
	)
	t.is(error.response.statusCode, 500)
	t.regex(error.response.body, /password.*undefined/)
})

test.serial('/api/login signs a user in', async (t) => {
	const {umbreld} = t.context

	t.is(await getCookie(), undefined)

	const {password} = testUserCredentials
	const response = await http.post(getAddress(umbreld, '/api/login'), {
		json: {password},
	})
	t.is(response.statusCode, 200)
	t.truthy(await getCookie())
})

test.serial('/api/renew-session renews the cookie expirey date', async (t) => {
	const {umbreld} = t.context

	const initialCookie = await getCookie()

	// Jump 5 seconds into the future otherwise we won't get a new expirey date
	// because cookie expirey dates only have 1 second resolution
	mockDate.set(Date.now() + 1000 * 5)
	t.teardown(() => mockDate.reset())

	const response = await http.post(getAddress(umbreld, '/api/renew-session'))
	t.is(response.statusCode, 200)

	const refreshedCookie = await getCookie()
	t.true(refreshedCookie.expires > initialCookie.expires)
})

test.serial('/api/logout logs the user out', async (t) => {
	const {umbreld} = t.context

	const response = await http.post(getAddress(umbreld, '/api/logout'))
	t.is(response.statusCode, 200)

	const error = await t.throwsAsync(() => http.post(getAddress(umbreld, '/api/renew-session')))
	t.is(error.response.statusCode, 401)
	t.regex(error.response.body, /Not authenticated/)
})
