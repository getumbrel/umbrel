// @vitest-environment jsdom

import {act} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, expect, test} from 'vitest'

import {useIsPhone, useIsPhoneNow} from './use-is-mobile'

;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
let input: HTMLInputElement
let seen: {phone: boolean; phoneNow: boolean}[] = []

function Probe() {
	const phone = useIsPhone()
	const phoneNow = useIsPhoneNow()
	seen.push({phone, phoneNow})
	return null
}

// useWindowSize, under useIsPhoneNow, waits for an animation frame
const frame = () => new Promise((resolve) => setTimeout(resolve, 50))

async function resize(width: number, height: number) {
	await act(async () => {
		Object.defineProperty(window, 'innerWidth', {configurable: true, value: width})
		Object.defineProperty(window, 'innerHeight', {configurable: true, value: height})
		window.dispatchEvent(new Event('resize'))
		await frame()
	})
}

const now = () => seen.at(-1)

beforeEach(async () => {
	// A foldable's inner display, before anything is focused
	input = document.createElement('input')
	document.body.appendChild(input)
	await resize(841, 701)
	container = document.createElement('div')
	document.body.appendChild(container)
	root = createRoot(container)
	await act(async () => root.render(<Probe />))
	seen = []
})

afterEach(async () => {
	await act(async () => root.unmount())
	container.remove()
	input.remove()
})

test('a window stays a window while the keyboard is up', async () => {
	input.focus()
	// The Android app's keyboard shrinks the window, a step at a time
	for (const height of [620, 480, 401]) await resize(841, height)
	expect(seen.every(({phone}) => !phone)).toBe(true)
	// Layouts still follow the window as it is
	expect(now()).toEqual({phone: false, phoneNow: true})

	// Tapping elsewhere takes the keyboard down, a step at a time
	input.blur()
	for (const height of [420, 560, 701]) await resize(841, height)
	expect(seen.every(({phone}) => !phone)).toBe(true)
	expect(now()).toEqual({phone: false, phoneNow: false})
})

test('a window that gets short with nothing focused is short', async () => {
	await resize(841, 401)
	expect(now()).toEqual({phone: true, phoneNow: true})
	await resize(841, 701)
	expect(now()).toEqual({phone: false, phoneNow: false})
})

test('turning the device while typing catches up', async () => {
	input.focus()
	await resize(841, 401)
	expect(now()?.phone).toBe(false)
	// A phone-sized window on its side
	await resize(900, 380)
	expect(now()).toEqual({phone: true, phoneNow: true})
	input.blur()
})
