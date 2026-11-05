// @vitest-environment jsdom

import {describe, expect, test} from 'vitest'

import {withDialog} from '@/utils/dialog'

import {parsePickerTarget, pickerTargetParams, type PickerTarget} from './target'

const search = (query: string) => new URLSearchParams(query)

describe('picker dialog target', () => {
	test('reads the picker, umbrelOS, or an app from the URL', () => {
		expect(parsePickerTarget('troubleshoot', search('dialog=troubleshoot'))).toEqual({type: 'picker'})
		expect(parsePickerTarget('terminal', search('dialog=terminal&terminal-target=umbrelos'))).toEqual({
			type: 'umbrelos',
		})
		expect(parsePickerTarget('terminal', search('dialog=terminal&app=bitcoin'))).toEqual({
			type: 'app',
			appId: 'bitcoin',
		})
	})

	test('falls back to the picker for a target it does not know', () => {
		expect(parsePickerTarget('troubleshoot', search('dialog=troubleshoot&troubleshoot-target=router'))).toEqual({
			type: 'picker',
		})
	})

	test('every target survives the trip through the URL', () => {
		const targets: PickerTarget[] = [{type: 'picker'}, {type: 'umbrelos'}, {type: 'app', appId: 'bitcoin'}]
		for (const target of targets) {
			const url = withDialog(search('sort=name'), 'troubleshoot', pickerTargetParams(target))
			expect(parsePickerTarget('troubleshoot', url)).toEqual(target)
		}
	})

	test('going back to the picker lets go of the app', () => {
		const url = withDialog(
			search('dialog=troubleshoot&app=bitcoin'),
			'troubleshoot',
			pickerTargetParams({type: 'picker'}),
		)
		expect(url.toString()).toBe('dialog=troubleshoot')
	})

	test('an app carries over from its settings to its terminal', () => {
		const url = withDialog(
			search('dialog=app-settings&app=bitcoin&view=storage'),
			'terminal',
			pickerTargetParams({type: 'app', appId: 'bitcoin'}),
		)
		expect(url.toString()).toBe('dialog=terminal&app=bitcoin')
	})
})
