// @vitest-environment jsdom

import {act} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, expect, it, vi} from 'vitest'

import {ExpandedContent} from './expanded'
import type {CloudIslandRow} from './index'

vi.mock('react-i18next', () => ({
	initReactI18next: {type: '3rdParty', init: vi.fn()},
	useTranslation: () => ({
		t: (key: string, options?: {transferred?: string; total?: string}) =>
			options?.total ? `${options.transferred} of ${options.total}` : key,
		i18n: {language: 'en'},
	}),
}))
vi.mock('motion/react', () => ({
	motion: {
		div: ({children, className}: {children?: React.ReactNode; className?: string}) => (
			<div className={className}>{children}</div>
		),
	},
}))
vi.mock('@/components/ui/scroll-area', () => ({
	ScrollArea: ({children}: {children: React.ReactNode}) => <div>{children}</div>,
}))
vi.mock('@/features/files/hooks/use-animated-number', () => ({
	useAnimatedNumber: (value: number | undefined) => value,
}))
vi.mock('@/features/files/components/shared/cloud-progress-bar', () => ({
	CloudProgressBar: () => <div />,
}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const row = (id: string, provider?: string): CloudIslandRow => ({
	id,
	name: `Transfer ${id}`,
	provider,
	providerName: provider,
	percent: 0,
	transferredFiles: 0,
	totalFiles: 1,
	transferredBytes: 0,
	totalBytes: 1,
	bytesPerSecond: 0,
})

let root: Root | undefined

afterEach(() => {
	if (root) act(() => root?.unmount())
	document.body.replaceChildren()
	root = undefined
})

it('uses a generic logo and an explicit zero byte rate for unresolved branding', () => {
	const container = document.createElement('div')
	document.body.appendChild(container)
	root = createRoot(container)

	act(() => root?.render(<ExpandedContent rows={[row('unknown')]} totalSpeed={0} />))

	expect(container.querySelector('img')?.getAttribute('src')).toBe('/assets/cloud/cloud.webp')
	expect(container.textContent).toContain('0 B/s')
	expect(container.textContent).not.toContain('-/s')
})

it('never renders a missing logo URL in the multi-transfer list', () => {
	const container = document.createElement('div')
	document.body.appendChild(container)
	root = createRoot(container)

	act(() =>
		root?.render(<ExpandedContent rows={[row('known', 'dropbox'), row('future', 'future-cloud')]} totalSpeed={0} />),
	)

	const images = [...container.querySelectorAll('img')]
	expect(images.map((image) => image.getAttribute('src'))).toEqual([
		'/assets/cloud/dropbox.svg',
		'/assets/cloud/cloud.webp',
	])
	expect(container.textContent).toContain('0 B/s')
})

it('groups the digits of file counts', () => {
	const container = document.createElement('div')
	document.body.appendChild(container)
	root = createRoot(container)

	act(() =>
		root?.render(
			<ExpandedContent
				rows={[{...row('large', 'dropbox'), transferredFiles: 1234, totalFiles: 98765}]}
				totalSpeed={0}
			/>,
		),
	)

	expect(container.textContent).toContain('1,234 of 98,765')
})
