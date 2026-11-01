import {parseUserAgent} from './vendored-ua-parser.ts'

export type SessionDeviceType = 'desktop' | 'mobile' | 'unknown'

export type SessionClient = {
	deviceType: SessionDeviceType
	/** Normalized browser brand name. Brand names are shown as-is, untranslated. */
	browser?: string
	/** Normalized OS name, used for the badge and tooltip, not the row label. */
	os?: string
	/** Row label: "Browser (OS)", else whichever is known, else the UA's leading product token (e.g. "curl"). */
	label?: string
	clientIcon?: string
	browserIcon?: string
	osIcon?: string
}

export type NativeSessionMetadata = {
	id: string
	platform: string
	deviceClass: string
	appVersion: string
	appBuild: string
	osVersion: string
}

// Display-name overrides for raw parser output (keyed lowercase). Raw captures keep
// the casing of the UA string itself, and a few upstream labels don't match how the
// brands are known today.
const browserNames: Record<string, string> = {
	'mobile safari': 'Safari',
	ucbrowser: 'UC Browser',
	ie: 'Internet Explorer',
	iemobile: 'Internet Explorer',
	brave: 'Brave',
	vivaldi: 'Vivaldi',
	chromium: 'Chromium',
	duckduckgo: 'DuckDuckGo',
	whale: 'Whale',
	ladybird: 'Ladybird',
	librewolf: 'LibreWolf',
	waterfox: 'Waterfox',
	electron: 'Electron',
}

// Browser icon slugs under public/assets/session-icons/browsers/ (keyed by
// lowercased *normalized* name). Browsers without an icon fall back to the
// generic device glyph in the UI. Chromium-fork detection caveats: Brave and Arc
// deliberately ship Chrome's exact UA, so desktop Brave and all of Arc render as
// Chrome; Tor Browser ships Firefox's UA on purpose and renders as Firefox.
const browserIcons: Record<string, string> = {
	chrome: 'chrome',
	'chrome headless': 'chrome',
	'chrome webview': 'chrome',
	chromium: 'chromium',
	edge: 'edge',
	firefox: 'firefox',
	'firefox focus': 'firefox',
	safari: 'safari',
	opera: 'opera',
	'opera gx': 'opera-gx',
	'opera mini': 'opera',
	'opera touch': 'opera',
	'opera coast': 'opera',
	vivaldi: 'vivaldi',
	'samsung internet': 'samsung-internet',
	duckduckgo: 'duckduckgo',
	'uc browser': 'uc-browser',
	yandex: 'yandex',
	brave: 'brave',
	'internet explorer': 'internet-explorer',
	ladybird: 'ladybird',
}

const osNames: Record<string, string> = {
	'mac os': 'macOS',
	'chromium os': 'ChromeOS',
	arch: 'Arch Linux',
}

const osIcons: Record<string, string> = {
	macos: 'apple',
	ios: 'apple',
	windows: 'windows',
	android: 'android',
	chromeos: 'chromeos',
	ubuntu: 'ubuntu',
	kubuntu: 'ubuntu',
	xubuntu: 'ubuntu',
	lubuntu: 'ubuntu',
	debian: 'debian',
	raspbian: 'debian',
	fedora: 'fedora',
	'arch linux': 'arch',
	freebsd: 'freebsd',
}

// Anything the distro/unix rules emit that has no dedicated icon still gets Tux.
const linuxFamily = new Set([
	'linux',
	'mint',
	'suse',
	'opensuse',
	'gentoo',
	'slackware',
	'mandriva',
	'centos',
	'pclinuxos',
	'red hat',
	'redhat',
	'zenwalk',
	'linpus',
	'deepin',
	'manjaro',
	'elementary os',
	'sabayon',
	'linspire',
	'gnu',
	'hurd',
])

function iconUrl(kind: 'browsers' | 'os', slug: string) {
	return `/assets/session-icons/${kind}/${slug}.png`
}

const nativePlatforms: Record<string, {name: string; icon: string}> = {
	ios: {name: 'iOS', icon: 'apple'},
	macos: {name: 'macOS', icon: 'apple'},
	android: {name: 'Android', icon: 'android'},
	windows: {name: 'Windows', icon: 'windows'},
}

const umbrelNativeLabels: Record<string, string> = {
	'ios:phone': 'Umbrel for iPhone',
	'ios:tablet': 'Umbrel for iPad',
	'macos:desktop': 'Umbrel for Mac',
	'android:phone': 'Umbrel for Android',
	'android:tablet': 'Umbrel for Android tablet',
	'windows:desktop': 'Umbrel for Windows',
	'windows:tablet': 'Umbrel for Windows tablet',
}

export function parseSessionUserAgent(userAgent?: string): SessionClient {
	if (!userAgent) return {deviceType: 'unknown'}

	// Only the Umbrel phone apps send this token: their in-app browser, and the login the
	// app makes for that browser. Show them as the app itself, like its native session. The
	// Android app's token ends in "(Android)"; the iPhone app's is bare.
	if (/\bUmbrelApp\//.test(userAgent)) {
		const platform = /\bUmbrelApp\/\S+ \(Android\)/.test(userAgent) ? 'android' : 'ios'
		return {
			deviceType: 'mobile',
			label: umbrelNativeLabels[`${platform}:phone`],
			clientIcon: '/assets/umbrel-ios.png',
			os: nativePlatforms[platform].name,
			osIcon: iconUrl('os', nativePlatforms[platform].icon),
		}
	}

	const deviceType: SessionDeviceType = /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent) ? 'mobile' : 'desktop'
	const parsed = parseUserAgent(userAgent)

	const browser = parsed.browser && (browserNames[parsed.browser.toLowerCase()] ?? parsed.browser)
	const os = parsed.os && (osNames[parsed.os.toLowerCase()] ?? parsed.os)

	const browserSlug = browser && browserIcons[browser.toLowerCase()]
	const osKey = os?.toLowerCase()
	const osSlug = osKey && (osIcons[osKey] ?? (linuxFamily.has(osKey) ? 'linux' : undefined))

	// Non-browser clients (curl, UmbrelDesktop/1.0, ...) label themselves by their
	// leading product token rather than showing "unknown device".
	const product = /^([A-Za-z][A-Za-z0-9 ._-]{0,39})\//.exec(userAgent)?.[1]

	const label = browser && os ? `${browser} (${os})` : (browser ?? os ?? product ?? undefined)

	return {
		deviceType,
		browser,
		os,
		label,
		browserIcon: browserSlug ? iconUrl('browsers', browserSlug) : undefined,
		osIcon: osSlug ? iconUrl('os', osSlug) : undefined,
	}
}

export function parseNativeSessionClient(client: NativeSessionMetadata): SessionClient {
	const deviceType: SessionDeviceType =
		client.deviceClass === 'desktop'
			? 'desktop'
			: client.deviceClass === 'phone' || client.deviceClass === 'tablet'
				? 'mobile'
				: 'unknown'
	const platform = nativePlatforms[client.platform]
	// Known clients receive product presentation; unknown identifiers remain
	// valid and fall back without expanding the server's authentication schema.
	const isUmbrel = client.id === 'umbrel'
	const label = isUmbrel ? (umbrelNativeLabels[`${client.platform}:${client.deviceClass}`] ?? 'Umbrel') : client.id

	return {
		deviceType,
		label,
		clientIcon: isUmbrel ? '/assets/umbrel-ios.png' : undefined,
		os: platform?.name,
		osIcon: platform ? iconUrl('os', platform.icon) : undefined,
	}
}
