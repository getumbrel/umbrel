// @vitest-environment jsdom

import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {expect, test} from 'vitest'

import {ToolPill} from '@/features/files/components/file-viewer/shell/tool-button'

;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

test('a pill that toggles says whether it is on or off; one that only acts says neither', async () => {
	const container = document.createElement('div')
	const root = createRoot(container)
	await act(async () =>
		root.render(
			<>
				<ToolPill active>Notes</ToolPill>
				<ToolPill active={false}>Edit</ToolPill>
				<ToolPill>Play</ToolPill>
			</>,
		),
	)
	expect([...container.querySelectorAll('button')].map((button) => button.getAttribute('aria-pressed'))).toEqual([
		'true',
		'false',
		null,
	])
	await act(async () => root.unmount())
})
