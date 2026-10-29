// @vitest-environment jsdom

import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {expect, test, vi} from 'vitest'

import {useApproximationNotice} from '@/features/files/components/file-viewer/shell/stage-states'

// The English copy, as en.json has it
const COPY: Record<string, string> = {
	'files-viewer.notice': '{{list}} can’t be shown fully here. They stay unchanged when you save.',
	'files-viewer.notice-read-only': '{{list}} can’t be shown fully here.',
	'files-viewer.notice-charts': 'charts',
	'files-viewer.notice-pictures': 'some pictures',
}
vi.mock('react-i18next', () => ({
	useTranslation: () => ({
		t: (key: string, values?: {list: string}) => COPY[key].replace('{{list}}', values?.list ?? ''),
		i18n: {language: 'en'},
	}),
}))
vi.mock('@/features/files/components/shared/file-item-icon', () => ({FileItemIcon: () => null}))
vi.mock('@/modules/auth/http-auth', () => ({useAuthorizedHttpUrl: (url?: string) => url}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

async function notice(approximated: Set<'charts' | 'pictures'>, editable: boolean) {
	let text = ''
	function Probe() {
		text = useApproximationNotice(approximated, editable)
		return null
	}
	const root = createRoot(document.createElement('div'))
	await act(async () => root.render(<Probe />))
	await act(async () => root.unmount())
	return text
}

test('the notice names what a file has drawn roughly, in a fixed order, and whether a save keeps it', async () => {
	expect(await notice(new Set(['pictures', 'charts']), true)).toBe(
		'Charts and some pictures can’t be shown fully here. They stay unchanged when you save.',
	)
	expect(await notice(new Set(['pictures']), false)).toBe('Some pictures can’t be shown fully here.')
	expect(await notice(new Set(), true)).toBe('')
})
