// @vitest-environment jsdom

import {describe, expect, test} from 'vitest'

import {withDialog, withoutDialog} from './dialog'

const search = (query: string) => new URLSearchParams(query)

describe('dialog slot', () => {
	test('closing takes the dialog and its prefixed params, and leaves the page its own', () => {
		expect(withoutDialog(search('sort=name&dialog=live-usage&live-usage-tab=cpu')).toString()).toBe('sort=name')
	})

	test('closing takes the unprefixed aliases a dialog owns', () => {
		expect(withoutDialog(search('dialog=app-settings&app=jellyfin&view=storage&sort=name')).toString()).toBe(
			'sort=name',
		)
	})

	test('a param belongs to a dialog only while that dialog is open', () => {
		expect(withoutDialog(search('app=jellyfin&live-usage-tab=cpu')).toString()).toBe('app=jellyfin&live-usage-tab=cpu')
		expect(withoutDialog(search('dialog=logout&live-usage-tab=cpu')).toString()).toBe('live-usage-tab=cpu')
	})

	test('opening names its params by the dialog, or by their alias', () => {
		expect(withDialog(search(''), 'live-usage', {tab: 'cpu'}).toString()).toBe('dialog=live-usage&live-usage-tab=cpu')
		expect(withDialog(search(''), 'app-settings', {for: 'jellyfin'}).toString()).toBe(
			'dialog=app-settings&app=jellyfin',
		)
	})

	test('opening over another dialog replaces it whole', () => {
		expect(withDialog(search('sort=name&dialog=app-settings&app=jellyfin&view=storage'), 'live-usage').toString()).toBe(
			'sort=name&dialog=live-usage',
		)
	})

	test('reopening a dialog drops the params it is not given again', () => {
		expect(withDialog(search('dialog=live-usage&live-usage-tab=cpu'), 'live-usage').toString()).toBe(
			'dialog=live-usage',
		)
	})

	test('the current search params are left untouched', () => {
		const current = search('dialog=live-usage&live-usage-tab=cpu')
		withDialog(current, 'logout')
		withoutDialog(current)
		expect(current.toString()).toBe('dialog=live-usage&live-usage-tab=cpu')
	})
})
