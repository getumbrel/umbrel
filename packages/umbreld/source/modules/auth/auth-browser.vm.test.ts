// @vm-requires-playwright
import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'
import createVmBrowser from '../test-utilities/create-vm-browser.ts'

describe.sequential('Dashboard browser authentication', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let vmBrowser: Awaited<ReturnType<typeof createVmBrowser>> | undefined
	let failed = false

	beforeAll(async () => {
		umbreld = await createTestVm({device: 'umbrel-home'})
	})

	afterAll(async () => {
		try {
			await vmBrowser?.close()
		} finally {
			await umbreld?.cleanup()
		}
	})

	afterEach(({task}) => {
		if (task.result?.state === 'fail') failed = true
	})

	beforeEach(({skip}) => {
		if (failed) skip()
	})

	test('boots VM and registers user', async () => {
		await umbreld.vm.powerOn()
		await umbreld.registerAndLogin()
	})

	test('logging out leaves a stable login page without authenticated subscriptions', async () => {
		vmBrowser = await createVmBrowser({
			forwardPorts: [{hostPort: umbreld.vm.httpPort, guestPort: 80}],
		})
		const context = await vmBrowser.browser.newContext()

		try {
			const page = await context.newPage()
			const loginNavigations: string[] = []
			const webSocketTicketRequests: string[] = []
			page.on('framenavigated', (frame) => {
				if (frame === page.mainFrame() && new URL(frame.url()).pathname === '/login') {
					loginNavigations.push(frame.url())
				}
			})
			page.on('request', (request) => {
				if (new URL(request.url()).pathname.includes('/trpc/user.createWebSocketTicket')) {
					webSocketTicketRequests.push(request.url())
				}
			})

			await page.goto('http://127.0.0.1/login')
			await page.getByRole('heading', {name: 'Welcome back'}).waitFor()
			await page.locator('input[type="password"]').fill('moneyprintergobrrr')
			await page.getByRole('button', {name: 'Log in'}).click()
			await page.waitForURL('http://127.0.0.1/')

			await page.goto('http://127.0.0.1/?dialog=logout')
			await page.getByRole('heading', {name: 'Are you sure you want to log out?'}).waitFor()
			await page.getByRole('button', {name: 'Log out', exact: true}).click()
			await page.waitForURL('http://127.0.0.1/login')
			await page.getByRole('heading', {name: 'Welcome back'}).waitFor()

			const navigationCountAfterLogout = loginNavigations.length
			const ticketCountAfterLogout = webSocketTicketRequests.length
			await page.waitForTimeout(2_000)

			expect(loginNavigations).toHaveLength(navigationCountAfterLogout)
			expect(webSocketTicketRequests).toHaveLength(ticketCountAfterLogout)
			expect(
				await page.evaluate(() =>
					(globalThis as unknown as {localStorage: {getItem(key: string): string | null}}).localStorage.getItem(
						'umbrel-auth-token',
					),
				),
			).toBeNull()
		} finally {
			await context.close()
		}
	})
})
