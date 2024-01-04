import {faker} from '@faker-js/faker'
import {expect, test} from '@playwright/test'

import {resetUmbreldAndStart} from './misc'

const TEST_USER = faker.person.firstName()
const TEST_PASSWORD = 'sdfsdf'

let stopUmbreld: (() => void) | null = null

test.beforeAll(async () => {
	// TODO: first check if we can reach umbreld. If so, we wanna reset it and restart it.
	// TODO: also check if ui is running. If not, start it.
	stopUmbreld = await resetUmbreldAndStart()
})

test.afterAll(async () => {
	stopUmbreld?.()
})

test('happy path', async ({page, context}) => {
	// Can reach backend at localhost:3001
	const response = await page.goto('localhost:3001/trpc/debug.sayHi')
	expect(response?.status()).toBe(200)

	await page.goto('localhost:3000')
	// Expect redirect to /onboarding
	await expect(page).toHaveURL(/\/onboarding/)
	// Expect to have button saying "Start"
	await expect(page.getByText('Start')).toBeVisible()

	// Click the button
	await page.click('text=Start')
	// Expect to go to `/1-create-account`
	await expect(page).toHaveURL(/\/1-create-account/)

	// Expect focus at `name`
	await expect(page.getByPlaceholder('Name')).toBeFocused()
	// Type name
	await page.getByPlaceholder('Name').fill(TEST_USER)
	// Type password
	// Exact because there's also a "Confirm password" field
	await page.getByPlaceholder('Password', {exact: true}).fill(TEST_PASSWORD)
	// Type password confirmation
	await page.getByPlaceholder('Confirm password').fill(TEST_PASSWORD)

	// await page.screenshot({path: 'test-results/onboarding.png'})

	// Submit
	await page.keyboard.press('Enter')

	// Click button
	// For some reason, this doesn't work
	// await page.click('text=Create')

	// Wait for redirect
	await page.waitForURL(/\/2-account-created/)
	await page.waitForLoadState()
	// Wait for text
	await page.waitForSelector('text=You’re all set')

	// await page.screenshot({path: 'test-results/onboarding-done.png'})

	// Expect button with text "Launch"
	await expect(page.getByTestId('to-desktop')).toBeVisible()

	// Click button
	// page.getByRole('button', {name: 'Launch'}).click()
	await page.keyboard.press('Enter')

	await page.waitForURL(/\/install-first-app/)
	await page.waitForLoadState()

	// Expect to be at `/install-first-app`
	await expect(page).toHaveURL(/\/install-first-app/)

	// Wait for page load
	await page.getByText('Install your first app')

	// Expect `Bitcoin Node` to be visible
	await expect(page.getByText('Bitcoin Node')).toBeVisible()

	// await page.screenshot({path: 'test-results/install-first-app.png'})

	// ----

	// Click Bitcoin Node
	await page.click('text=Bitcoin Node')

	// Expect to be at '/app-store`
	await expect(page).toHaveURL(/\/app-store/)

	const top = page.getByTestId('app-top')

	// Click install
	await top.getByRole('button', {name: 'Install'}).click()

	await expect(top.getByRole('button', {name: 'Installing'})).toBeVisible()

	await expect(top.getByRole('button', {name: 'Open'})).toBeVisible({timeout: 20000})

	// Click open
	const pagePromise = context.waitForEvent('page')
	await top.getByRole('button', {name: 'Open'}).click()

	const newPage = await pagePromise

	// console.log(await newPage.title())
	// console.log(await newPage.url())

	// TODO: this doesn't work
	// await expect(newPage).toHaveURL(/localhost:2100/)
	// Expect `chrome-error://chromewebdata/`
	await expect(newPage).toHaveURL(/chrome-error:\/\/chromewebdata\//)
	await newPage.close()

	// Item in dock
	// Click on link href that has `/settings`
	await page.click('a[href*="/settings"]')

	// Expect to be at `/settings`
	await expect(page).toHaveURL(/\/settings/)

	// Scroll to Factory reset
	await page.click('text=Factory reset')

	// Fill Device name
	await page.getByPlaceholder('Device name').fill(TEST_USER)
	// Enter
	await page.keyboard.press('Enter')

	// Await redirect
	await page.waitForURL(/\/factory-reset/)

	// Press continue
	// await page.keyboard.press('Enter')
	await page.click('text=Continue')

	// Await redirect
	await page.waitForURL(/\/factory-reset\/confirm/)

	// Enter password
	await page.getByLabel('Enter password').fill(TEST_PASSWORD)

	// Enter
	await page.keyboard.press('Enter')

	// Await redirect
	await page.waitForURL(/\/factory-reset\/resetting/)
})
