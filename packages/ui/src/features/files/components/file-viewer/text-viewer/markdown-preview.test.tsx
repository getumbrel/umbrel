// @vitest-environment jsdom
import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {expect, test} from 'vitest'

import {MarkdownPreview} from '@/features/files/components/file-viewer/text-viewer/markdown-preview'

;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

// The preview as it's drawn
async function preview(markdown: string) {
	const container = document.createElement('div')
	const root = createRoot(container)
	await act(async () => root.render(<MarkdownPreview content={markdown} />))
	return container
}

// Each link as its words and where it goes
const links = (container: HTMLElement) =>
	[...container.querySelectorAll('a')].map((link) => [link.textContent, link.getAttribute('href')])

test('a picture is never fetched: its description stands in for it, linked to the picture', async () => {
	const container = await preview(
		[
			'![Chart of sales](https://example.com/chart.png)',
			'![](https://tracker.example/pixel.gif?reader=42)',
			'[![Build status](https://ci.example/badge.svg)](https://ci.example/builds)',
			'![Diagram](./diagram.png)',
			'![](data:image/png;base64,iVBORw0KGgo=)',
			'<img src="https://example.com/raw.png" onerror="alert(1)">',
		].join('\n\n'),
	)
	// Nothing the browser would load on its own
	expect(container.querySelector('img, picture, video, audio, source, iframe, object, embed')).toBeNull()
	expect(links(container)).toEqual([
		['Chart of sales', 'https://example.com/chart.png'],
		// With no description, where it's kept says what it is
		['tracker.example', 'https://tracker.example/pixel.gif?reader=42'],
		// A picture that is itself a link goes where its link does
		['Build status', 'https://ci.example/builds'],
	])
	// One kept beside the file isn't on the web to link to
	expect(container.textContent).toContain('Diagram')
	for (const link of container.querySelectorAll('a')) {
		expect(link.target).toBe('_blank')
		expect(link.rel).toBe('noopener noreferrer')
	}
})

test('a link opens only a web page or mail: any other stays as its words', async () => {
	const container = await preview(
		[
			'[web](https://example.com/page "Example")',
			'[mail](mailto:satoshi@example.com)',
			'[path](/settings/advanced)',
			'[sibling](notes/other.md)',
			'[place](#heading)',
			'[script](javascript:alert(1))',
			'[local](file:///etc/passwd)',
			'www.example.org',
		].join('\n\n'),
	)
	expect(links(container)).toEqual([
		['web', 'https://example.com/page'],
		['mail', 'mailto:satoshi@example.com'],
		['www.example.org', 'http://www.example.org/'],
	])
	expect(container.querySelector('a')!.title).toBe('Example')
	for (const words of ['path', 'sibling', 'place', 'script', 'local']) expect(container.textContent).toContain(words)
})
