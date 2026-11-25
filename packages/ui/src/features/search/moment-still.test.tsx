// @vitest-environment jsdom

import {act} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, expect, test, vi} from 'vitest'

import {MomentStill} from './moment-still'

vi.mock('@/modules/auth/http-url-authorizer', () => ({
	useSharedAuthorizedHttpUrl: (url: string | undefined) => url && `${url}&token=t`,
}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
	host = document.createElement('div')
	document.body.append(host)
	root = createRoot(host)
})

afterEach(() => {
	act(() => root.unmount())
	host.remove()
})

const render = (url: string) => act(() => root.render(<MomentStill url={url} backdrop='#336699' />))
const img = () => host.querySelector('img')!
const settle = (type: 'load' | 'error') => act(() => void img().dispatchEvent(new Event(type)))

test('covers the thumbnail beneath in its colour until the still arrives, then shows the still', () => {
	render('/api/search/moment/a.jpg?path=%2FHome%2Fdog.mp4&t=35000')
	expect(img().getAttribute('src')).toBe('/api/search/moment/a.jpg?path=%2FHome%2Fdog.mp4&t=35000&token=t')
	expect(host.querySelector('span')!.style.backgroundColor).toBe('rgb(51, 102, 153)')
	expect(img().className).toContain('opacity-0')
	settle('load')
	expect(img().className).toContain('opacity-100')
})

test('a still that cannot be had steps aside, and another moment gets its own chance', () => {
	render('/still?t=1000')
	settle('error')
	expect(host.innerHTML).toBe('')
	render('/still?t=2000')
	expect(img().className).toContain('opacity-0')
	settle('load')
	expect(img().className).toContain('opacity-100')
})
