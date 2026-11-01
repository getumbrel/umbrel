import assert from 'node:assert/strict'
import test from 'node:test'

import {finishLogout, finishLogoutOnUnauthorized} from './logout.ts'
import {parseNativeSessionClient, parseSessionUserAgent} from './session-user-agent.ts'
import {AUTH_TOKEN_LOCAL_STORAGE_KEY, AUTH_TOKEN_REFRESH_LOCAL_STORAGE_KEY} from './token-renewal.ts'

class MemoryStorage {
	#values = new Map<string, string>()

	getItem(key: string) {
		return this.#values.get(key) ?? null
	}

	setItem(key: string, value: string) {
		this.#values.set(key, value)
	}

	removeItem(key: string) {
		this.#values.delete(key)
	}
}

test('finishing a current-session revocation clears auth state before navigating to login', () => {
	const storage = new MemoryStorage()
	storage.setItem(AUTH_TOKEN_LOCAL_STORAGE_KEY, 'dashboard-token')
	storage.setItem(AUTH_TOKEN_REFRESH_LOCAL_STORAGE_KEY, '1234')
	const redirects: string[] = []

	finishLogout(storage, (path) => redirects.push(path))

	assert.equal(storage.getItem(AUTH_TOKEN_LOCAL_STORAGE_KEY), null)
	assert.equal(storage.getItem(AUTH_TOKEN_REFRESH_LOCAL_STORAGE_KEY), null)
	assert.deepEqual(redirects, ['/login'])
})

test('an unauthorized WS ticket response clears a stale session instead of retrying forever', () => {
	const storage = new MemoryStorage()
	storage.setItem(AUTH_TOKEN_LOCAL_STORAGE_KEY, 'revoked-token')
	storage.setItem(AUTH_TOKEN_REFRESH_LOCAL_STORAGE_KEY, '1234')
	const redirects: string[] = []

	assert.equal(
		finishLogoutOnUnauthorized({data: {code: 'UNAUTHORIZED'}}, storage, (path) => redirects.push(path)),
		true,
	)
	assert.equal(storage.getItem(AUTH_TOKEN_LOCAL_STORAGE_KEY), null)
	assert.equal(storage.getItem(AUTH_TOKEN_REFRESH_LOCAL_STORAGE_KEY), null)
	assert.deepEqual(redirects, ['/login'])

	assert.equal(
		finishLogoutOnUnauthorized({data: {code: 'BAD_REQUEST'}}, storage, () => {}),
		false,
	)
})

// Real-world user agents (post UA-reduction where applicable) and the exact
// browser/OS/icon output the sessions UI renders for each. Ordering in the
// vendored regex tables is what keeps the Chromium forks apart, so this corpus
// is what guards against silent reorderings.
const corpus: Array<{
	name: string
	ua: string
	browser?: string
	os?: string
	browserIcon?: string
	osIcon?: string
}> = [
	{
		name: 'Chrome on macOS',
		ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
		browser: 'Chrome',
		os: 'macOS',
		browserIcon: 'chrome',
		osIcon: 'apple',
	},
	{
		name: 'Edge on Windows',
		ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0',
		browser: 'Edge',
		os: 'Windows',
		browserIcon: 'edge',
		osIcon: 'windows',
	},
	{
		name: 'Edge on iOS',
		ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/126.0.2592.56 Version/17.0 Mobile/15E148 Safari/604.1',
		browser: 'Edge',
		os: 'iOS',
		browserIcon: 'edge',
		osIcon: 'apple',
	},
	{
		name: 'Edge on Android',
		ua: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36 EdgA/138.0.0.0',
		browser: 'Edge',
		os: 'Android',
		browserIcon: 'edge',
		osIcon: 'android',
	},
	{
		name: 'Safari on iPhone',
		ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
		browser: 'Safari',
		os: 'iOS',
		browserIcon: 'safari',
		osIcon: 'apple',
	},
	{
		name: 'Safari on macOS (also iPadOS in desktop mode, which is indistinguishable server-side)',
		ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
		browser: 'Safari',
		os: 'macOS',
		browserIcon: 'safari',
		osIcon: 'apple',
	},
	{
		name: 'Chrome on iOS',
		ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1',
		browser: 'Chrome',
		os: 'iOS',
		browserIcon: 'chrome',
		osIcon: 'apple',
	},
	{
		name: 'Firefox on Linux',
		ua: 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0',
		browser: 'Firefox',
		os: 'Linux',
		browserIcon: 'firefox',
		osIcon: 'linux',
	},
	{
		name: 'Firefox on iOS',
		ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15',
		browser: 'Firefox',
		os: 'iOS',
		browserIcon: 'firefox',
		osIcon: 'apple',
	},
	{
		name: 'Vivaldi on Windows',
		ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Vivaldi/6.8.3381.48',
		browser: 'Vivaldi',
		os: 'Windows',
		browserIcon: 'vivaldi',
		osIcon: 'windows',
	},
	{
		name: 'Opera on Windows',
		ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 OPR/110.0.0.0',
		browser: 'Opera',
		os: 'Windows',
		browserIcon: 'opera',
		osIcon: 'windows',
	},
	{
		name: 'Opera GX on Windows (sends both OPR and OPX tokens)',
		ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 OPR/110.0.0.0 OPX/2.5.1',
		browser: 'Opera GX',
		os: 'Windows',
		browserIcon: 'opera-gx',
		osIcon: 'windows',
	},
	{
		name: 'Samsung Internet on Android',
		ua: 'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
		browser: 'Samsung Internet',
		os: 'Android',
		browserIcon: 'samsung-internet',
		osIcon: 'android',
	},
	{
		name: 'DuckDuckGo on macOS',
		ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) DuckDuckGo/7 Safari/605.1.15',
		browser: 'DuckDuckGo',
		os: 'macOS',
		browserIcon: 'duckduckgo',
		osIcon: 'apple',
	},
	{
		name: 'Yandex on Windows',
		ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 YaBrowser/24.7.0.0 Safari/537.36',
		browser: 'Yandex',
		os: 'Windows',
		browserIcon: 'yandex',
		osIcon: 'windows',
	},
	{
		name: 'UC Browser on Android',
		ua: 'Mozilla/5.0 (Linux; U; Android 14; en-US; SM-A155F) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/100.0.4896.58 UCBrowser/13.4.0.1306 Mobile Safari/537.36',
		browser: 'UC Browser',
		os: 'Android',
		browserIcon: 'uc-browser',
		osIcon: 'android',
	},
	{
		name: 'legacy Brave (only pre-2018 desktop Brave is UA-detectable; modern Brave ships Chrome’s UA)',
		ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) brave/0.23.107 Chrome/68.0.3440.87 Safari/537.36',
		browser: 'Brave',
		os: 'Windows',
		browserIcon: 'brave',
		osIcon: 'windows',
	},
	{
		name: 'Chrome on ChromeOS',
		ua: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
		browser: 'Chrome',
		os: 'ChromeOS',
		browserIcon: 'chrome',
		osIcon: 'chromeos',
	},
	{
		name: 'Chrome on Ubuntu',
		ua: 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
		browser: 'Chrome',
		os: 'Ubuntu',
		browserIcon: 'chrome',
		osIcon: 'ubuntu',
	},
	{
		name: 'Android WebView (in-app browser)',
		ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36',
		browser: 'Chrome WebView',
		os: 'Android',
		browserIcon: 'chrome',
		osIcon: 'android',
	},
	{
		name: 'Electron app',
		ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) SomeApp/1.0 Chrome/120.0.0.0 Electron/28.0.0 Safari/537.36',
		browser: 'Electron',
		os: 'macOS',
		browserIcon: undefined,
		osIcon: 'apple',
	},
	{
		name: 'Ladybird',
		ua: 'Mozilla/5.0 (X11; Linux x86_64) Ladybird/1.0',
		browser: 'Ladybird',
		os: 'Linux',
		browserIcon: 'ladybird',
		osIcon: 'linux',
	},
	{
		name: 'Tor Browser (deliberately uniform: always Firefox on Windows, regardless of real OS)',
		ua: 'Mozilla/5.0 (Windows NT 10.0; rv:128.0) Gecko/20100101 Firefox/128.0',
		browser: 'Firefox',
		os: 'Windows',
		browserIcon: 'firefox',
		osIcon: 'windows',
	},
]

test('identifies browsers and platforms from real user agents, with matching icons', () => {
	for (const expected of corpus) {
		const client = parseSessionUserAgent(expected.ua)
		assert.deepEqual(
			{
				browser: client.browser,
				os: client.os,
				browserIcon: client.browserIcon,
				osIcon: client.osIcon,
			},
			{
				browser: expected.browser,
				os: expected.os,
				browserIcon: expected.browserIcon && `/assets/session-icons/browsers/${expected.browserIcon}.png`,
				osIcon: expected.osIcon && `/assets/session-icons/os/${expected.osIcon}.png`,
			},
			expected.name,
		)
		const expectedLabel =
			expected.browser && expected.os ? `${expected.browser} (${expected.os})` : (expected.browser ?? expected.os)
		assert.equal(client.label, expectedLabel, expected.name)
	}
})

test('labels non-browser clients by their product token instead of "unknown"', () => {
	const curl = parseSessionUserAgent('curl/8.7.1')
	assert.equal(curl.label, 'curl')
	assert.equal(curl.browser, undefined)
	assert.equal(curl.browserIcon, undefined)

	assert.equal(parseSessionUserAgent('UmbrelDesktop/1.0').label, 'UmbrelDesktop')
	assert.equal(parseSessionUserAgent(undefined).label, undefined)
})

test('classifies mobile, desktop, and missing user agents for session icons', () => {
	assert.equal(parseSessionUserAgent('Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile').deviceType, 'mobile')
	assert.equal(parseSessionUserAgent('Mozilla/5.0 (X11; Linux x86_64) Firefox/128.0').deviceType, 'desktop')
	assert.equal(parseSessionUserAgent(undefined).deviceType, 'unknown')
})

test('labels the iPhone app in-app browser and its login as the app', () => {
	const userAgents = [
		// The in-app web view: WebKit's iPhone user agent plus the app's applicationNameForUserAgent.
		'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1 UmbrelApp/0.1',
		// The browser login the app makes alongside its native sign-in.
		'UmbrelApp/0.1',
	]

	for (const userAgent of userAgents) {
		const client = parseSessionUserAgent(userAgent)
		assert.equal(client.label, 'Umbrel for iPhone', userAgent)
		assert.equal(client.deviceType, 'mobile', userAgent)
		assert.equal(client.clientIcon, '/assets/umbrel-ios.png', userAgent)
		assert.equal(client.os, 'iOS', userAgent)
		assert.equal(client.osIcon, '/assets/session-icons/os/apple.png', userAgent)
	}

	assert.equal(parseSessionUserAgent('UmbrelAppAuthVm/1.0').label, 'UmbrelAppAuthVm')
})

test('labels the Android app in-app browser and its login as the app', () => {
	const userAgents = [
		// The in-app web view: WebView's own user agent plus the app's token.
		'Mozilla/5.0 (Linux; Android 16; Pixel 8a Build/BP3A.250905.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/153.0.8010.57 Mobile Safari/537.36 UmbrelApp/0.1 (Android)',
		// The browser login the app makes alongside its native sign-in.
		'UmbrelApp/0.1 (Android)',
	]

	for (const userAgent of userAgents) {
		const client = parseSessionUserAgent(userAgent)
		assert.equal(client.label, 'Umbrel for Android', userAgent)
		assert.equal(client.deviceType, 'mobile', userAgent)
		assert.equal(client.clientIcon, '/assets/umbrel-ios.png', userAgent)
		assert.equal(client.os, 'Android', userAgent)
		assert.equal(client.osIcon, '/assets/session-icons/os/android.png', userAgent)
	}
})

test('uses structured native metadata for client labels and icons', () => {
	const common = {appVersion: '0.1', appBuild: '20', osVersion: '26.6.1'}
	const cases = [
		{
			client: {id: 'umbrel', platform: 'ios', deviceClass: 'phone', ...common} as const,
			label: 'Umbrel for iPhone',
			deviceType: 'mobile',
			os: 'iOS',
			osIcon: 'apple',
		},
		{
			client: {id: 'umbrel', platform: 'ios', deviceClass: 'tablet', ...common} as const,
			label: 'Umbrel for iPad',
			deviceType: 'mobile',
			os: 'iOS',
			osIcon: 'apple',
		},
		{
			client: {id: 'umbrel', platform: 'macos', deviceClass: 'desktop', ...common} as const,
			label: 'Umbrel for Mac',
			deviceType: 'desktop',
			os: 'macOS',
			osIcon: 'apple',
		},
		{
			client: {id: 'umbrel', platform: 'android', deviceClass: 'phone', ...common} as const,
			label: 'Umbrel for Android',
			deviceType: 'mobile',
			os: 'Android',
			osIcon: 'android',
		},
		{
			client: {id: 'umbrel', platform: 'windows', deviceClass: 'desktop', ...common} as const,
			label: 'Umbrel for Windows',
			deviceType: 'desktop',
			os: 'Windows',
			osIcon: 'windows',
		},
	]

	for (const expected of cases) {
		const client = parseNativeSessionClient(expected.client)
		assert.equal(client.label, expected.label)
		assert.equal(client.deviceType, expected.deviceType)
		assert.equal(client.clientIcon, '/assets/umbrel-ios.png')
		assert.equal(client.os, expected.os)
		assert.equal(client.osIcon, `/assets/session-icons/os/${expected.osIcon}.png`)
	}
})

test('unknown native clients degrade without requiring a UI catalog entry', () => {
	const unknown = parseNativeSessionClient({
		id: 'example-linux',
		platform: 'linux',
		deviceClass: 'laptop',
		appVersion: '1.0',
		appBuild: '42',
		osVersion: '7.0',
	})
	assert.equal(unknown.label, 'example-linux')
	assert.equal(unknown.deviceType, 'unknown')
	assert.equal(unknown.clientIcon, undefined)
	assert.equal(unknown.os, undefined)
	assert.equal(unknown.osIcon, undefined)

	const futureUmbrel = parseNativeSessionClient({
		id: 'umbrel',
		platform: 'visionos',
		deviceClass: 'headset',
		appVersion: '1.0',
		appBuild: '1',
		osVersion: '3.0',
	})
	assert.equal(futureUmbrel.label, 'Umbrel')
	assert.equal(futureUmbrel.clientIcon, '/assets/umbrel-ios.png')
})
