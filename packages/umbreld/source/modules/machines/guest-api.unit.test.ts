import http from 'node:http'

import {describe, expect, test, vi} from 'vitest'

import MachineGuestApi from './guest-api.ts'

async function chunkedPost(url: string, chunks: string[]) {
	return new Promise<number | undefined>((resolve, reject) => {
		const request = http.request(
			url,
			{method: 'POST', headers: {'content-type': 'application/x-www-form-urlencoded'}},
			(response) => {
				response.resume()
				response.on('end', () => resolve(response.statusCode))
			},
		)
		request.on('error', reject)
		for (const chunk of chunks) request.write(chunk)
		request.end()
	})
}

describe('machine guest API', () => {
	test('exposes only the authenticated first-boot completion callback', async () => {
		const completeFirstBootSetup = vi.fn(async () => true)
		const api = new MachineGuestApi({
			host: '127.0.0.1',
			port: 0,
			completeFirstBootSetup,
			logger: {log: vi.fn(), error: vi.fn()},
		})
		await api.start()
		const url = `http://127.0.0.1:${api.port}`
		const token = 'ab'.repeat(32)

		const completionUrl = `${url}/api/machines/first-boot/test-machine/${token}`
		await expect(
			fetch(completionUrl, {
				method: 'POST',
				headers: {'content-type': 'application/x-www-form-urlencoded'},
				body: 'instance_id=ubuntu-test',
			}),
		).resolves.toMatchObject({status: 204})
		expect(completeFirstBootSetup).toHaveBeenCalledWith('test-machine', token)
		await expect(fetch(`${url}/api/machines/first-boot/test-machine/${token}`)).resolves.toMatchObject({status: 404})
		await expect(fetch(`${url}/trpc`)).resolves.toMatchObject({status: 404})
		await expect(fetch(completionUrl, {method: 'POST'})).resolves.toMatchObject({status: 204})
		await expect(chunkedPost(completionUrl, ['instance_id=', 'ubuntu-chunked'])).resolves.toBe(204)

		await api.stop()
	})

	test('rejects oversized first-boot bodies before completing setup', async () => {
		const completeFirstBootSetup = vi.fn(async () => true)
		const api = new MachineGuestApi({
			host: '127.0.0.1',
			port: 0,
			completeFirstBootSetup,
			logger: {log: vi.fn(), error: vi.fn()},
		})
		await api.start()
		const token = 'ab'.repeat(32)

		await expect(
			fetch(`http://127.0.0.1:${api.port}/api/machines/first-boot/test-machine/${token}`, {
				method: 'POST',
				headers: {'content-type': 'application/x-www-form-urlencoded'},
				body: 'x'.repeat(4 * 1024 + 1),
			}),
		).resolves.toMatchObject({status: 413})
		await expect(
			chunkedPost(`http://127.0.0.1:${api.port}/api/machines/first-boot/test-machine/${token}`, [
				'x'.repeat(4 * 1024),
				'x',
			]),
		).resolves.toBe(413)
		expect(completeFirstBootSetup).not.toHaveBeenCalled()

		await api.stop()
	})

	test('does not reveal whether the machine or token was invalid', async () => {
		const api = new MachineGuestApi({
			host: '127.0.0.1',
			port: 0,
			completeFirstBootSetup: async () => {
				throw new Error('[machine-first-boot-token-invalid]')
			},
			logger: {log: vi.fn(), error: vi.fn()},
		})
		await api.start()

		await expect(
			fetch(`http://127.0.0.1:${api.port}/api/machines/first-boot/missing/${'cd'.repeat(32)}`, {method: 'POST'}),
		).resolves.toMatchObject({status: 404})

		await api.stop()
	})
})
