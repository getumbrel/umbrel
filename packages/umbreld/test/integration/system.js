import test from 'ava'
import got from 'got'
import {CookieJar} from 'tough-cookie'

import createUmbreld from '../../test/helpers/create-umbreld.js'
import temporaryDirectory from '../../test/helpers/temporary-directory.js'

const getAddress = (umbreld, endpoint) => {
	const port = umbreld.modules.server.port

	return `http://localhost:${port}${endpoint}`
}

const cookieJar = new CookieJar()
const http = got.extend({cookieJar})

const testUserCredentials = {
	username: 'satoshi',
	password: 'moneyprintergobrrr',
}

const directory = temporaryDirectory('system')

test.before(async (t) => {
	await directory.createRoot()
	const dataDirectory = await directory.create()
	t.context.umbreld = await createUmbreld(dataDirectory)
})
test.after.always(directory.destroyRoot)

test.serial('/api/cpu-temperature returns 401 if no authentication', async (t) => {
	const {umbreld} = t.context

	const error = await t.throwsAsync(got.get(getAddress(umbreld, '/api/cpu-temperature')))
	t.is(error.response.statusCode, 401)
	t.regex(error.response.body, /Not authenticated/)
})

test.serial('/api/disk-usage returns 401 if no authentication', async (t) => {
	const {umbreld} = t.context

	const error = await t.throwsAsync(got.get(getAddress(umbreld, '/api/disk-usage')))
	t.is(error.response.statusCode, 401)
	t.regex(error.response.body, /Not authenticated/)
})

test.serial('/api/memory-usage returns 401 if no authentication', async (t) => {
	const {umbreld} = t.context

	const error = await t.throwsAsync(got.get(getAddress(umbreld, '/api/memory-usage')))
	t.is(error.response.statusCode, 401)
	t.regex(error.response.body, /Not authenticated/)
})

test.serial('/api/shutdown returns 401 if no authentication', async (t) => {
	const {umbreld} = t.context

	const error = await t.throwsAsync(got.post(getAddress(umbreld, '/api/shutdown')))
	t.is(error.response.statusCode, 401)
	t.regex(error.response.body, /Not authenticated/)
})

test.serial('/api/restart returns 401 if no authentication', async (t) => {
	const {umbreld} = t.context

	const error = await t.throwsAsync(got.post(getAddress(umbreld, '/api/restart')))
	t.is(error.response.statusCode, 401)
	t.regex(error.response.body, /Not authenticated/)
})

// Register and login a user for the next batch of tests
test.serial('Create user and log in', async (t) => {
	const {umbreld} = t.context

	const registerResponse = await http.post(getAddress(umbreld, '/api/register'), {
		json: testUserCredentials,
	})

	t.is(registerResponse.statusCode, 200)

	const {password} = testUserCredentials
	const loginResponse = await http.post(getAddress(umbreld, '/api/login'), {
		json: {password},
	})

	t.is(loginResponse.statusCode, 200)
})

test.serial('/api/cpu-temperature returns cpu temperature', async (t) => {
	const {umbreld} = t.context

	const response = await http.get(getAddress(umbreld, '/api/cpu-temperature'))
	// Comment these out cos they fail on VMs
	// const body = JSON.parse(response.body)
	// const {temperatureCelsius} = body
	// TODO: remove this log
	// console.log(`CPU temperature: ${temperatureCelsius}`)

	t.is(response.statusCode, 200)
	// Comment these out cos they fail on VMs
	// t.is(typeof temperatureCelsius, 'number')
	// t.true(temperatureCelsius > 0, 'Expect temperature to be greater than 0')
})

test.serial('/api/disk-usage returns disk usage', async (t) => {
	const {umbreld} = t.context

	const response = await http.get(getAddress(umbreld, '/api/disk-usage'))
	const body = JSON.parse(response.body)
	const {diskUsageBytes} = body
	// TODO: remove this log
	// console.table(diskUsageBytes)

	t.is(response.statusCode, 200)
	t.is(typeof diskUsageBytes, 'object')
	t.true(diskUsageBytes.size > 0, 'Expect total disk usage to be greater than 0')
	t.true(diskUsageBytes.used > 0, 'Expect used disk usage to be greater than 0')
	t.true(diskUsageBytes.available > 0, 'Expect available disk usage to be greater than 0')
})

test.serial('/api/memory-usage returns memory usage', async (t) => {
	const {umbreld} = t.context

	const response = await http.get(getAddress(umbreld, '/api/memory-usage'))
	const body = JSON.parse(response.body)
	const {memoryUsageBytes} = body
	// TODO: remove this log
	// console.table(memoryUsage)

	t.is(response.statusCode, 200)
	t.is(typeof memoryUsageBytes, 'object')
	t.true(memoryUsageBytes.total > 0, 'Expect total memory usage to be greater than 0')
	t.true(memoryUsageBytes.free > 0, 'Expect free memory usage to be greater than 0')
	t.true(memoryUsageBytes.used > 0, 'Expect used memory usage to be greater than 0')
	t.true(memoryUsageBytes.active > 0, 'Expect active memory usage to be greater than 0')
	t.true(memoryUsageBytes.available > 0, 'Expect available memory usage to be greater than 0')
})

test.serial('/api/shutdown shuts down the system', async (t) => {
	const {umbreld} = t.context

	const response = await http.post(getAddress(umbreld, '/api/shutdown'))
	t.is(response.statusCode, 200)
})

test.serial('/api/restart restarts the system', async (t) => {
	const {umbreld} = t.context

	const response = await http.post(getAddress(umbreld, '/api/restart'))
	t.is(response.statusCode, 200)
})
