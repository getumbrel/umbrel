// @vitest-environment jsdom

import {notifyManager, QueryClient, QueryClientProvider, useMutation} from '@tanstack/react-query'
import {act} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, expect, it, vi} from 'vitest'

import {PhoneSourceName} from './phone-source-name'

const mocks = vi.hoisted(() => ({rename: vi.fn(), refresh: vi.fn(), error: vi.fn()}))
vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}))
vi.mock('@/components/ui/toast', () => ({toast: {error: mocks.error}}))
vi.mock('@/features/files/hooks/use-home-directory-name', () => ({useHomeDirectoryName: () => 'Home'}))
// Keep the real actions hook and mutation state; only replace the tRPC transport.
vi.mock('@/trpc/trpc', () => ({
	trpcReact: {
		useUtils: () => ({photos: {sources: {invalidate: mocks.refresh}, invalidate: vi.fn()}}),
		photos: {
			sources: {
				rename: {
					useMutation: (options: {onSuccess: () => Promise<unknown>}) =>
						useMutation({mutationFn: mocks.rename, ...options}),
				},
				update: {useMutation: () => ({mutateAsync: vi.fn()})},
				remove: {useMutation: () => ({mutateAsync: vi.fn(), isPending: false})},
			},
		},
	},
}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
let root: Root
let queryClient: QueryClient
let container: HTMLDivElement
const source = {id: 'iphone:source', name: 'My iPhone'}

function render(name = source.name) {
	root.render(
		<QueryClientProvider client={queryClient}>
			<PhoneSourceName source={{...source, name}} />
		</QueryClientProvider>,
	)
}

beforeEach(() => {
	vi.resetAllMocks()
	mocks.rename.mockResolvedValue(undefined)
	mocks.refresh.mockResolvedValue(undefined)
	notifyManager.setScheduler(queueMicrotask)
	queryClient = new QueryClient()
	container = document.createElement('div')
	document.body.appendChild(container)
	root = createRoot(container)
	act(() => render())
})

afterEach(() => {
	act(() => root.unmount())
	queryClient.clear()
	notifyManager.setScheduler((callback) => setTimeout(callback, 0))
	container.remove()
})

function button(label: string) {
	return Array.from(container.querySelectorAll('button')).find((button) => button.getAttribute('aria-label') === label)!
}

function edit() {
	act(() => container.querySelector<HTMLButtonElement>('button[aria-label]')!.click())
	return container.querySelector('input')!
}

function type(value: string) {
	act(() => {
		const input = container.querySelector('input')!
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
		input.dispatchEvent(new Event('input', {bubbles: true}))
	})
}

async function submit() {
	await act(async () => {
		container.querySelector('form')!.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}))
	})
}

it('shows the current name as an accessible rename button and opens a selected editor', () => {
	const rename = button('photos-source.rename: My iPhone')
	expect(rename.getAttribute('aria-label')).toBe('photos-source.rename: My iPhone')
	expect(rename.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
	expect(container.querySelector('input')).toBeNull()
	const input = edit()
	expect(input.value).toBe('My iPhone')
	expect(input.getAttribute('aria-label')).toBe('name')
	expect(input.maxLength).toBe(100)
	expect(document.activeElement).toBe(input)
	expect(input.selectionStart).toBe(0)
	expect(input.selectionEnd).toBe(source.name.length)
	expect(button('photos-source.rename-save').disabled).toBe(true)
})

it('saves the trimmed name, prevents repeated submission, and shows the refreshed name', async () => {
	let finish!: () => void
	let finishRefresh!: () => void
	mocks.rename.mockImplementation(
		() =>
			new Promise<void>((resolve) => {
				finish = resolve
			}),
	)
	mocks.refresh.mockImplementation(
		() =>
			new Promise<void>((resolve) => {
				finishRefresh = resolve
			}),
	)
	const input = edit()
	type('  Holiday phone  ')
	await act(async () => {
		const save = button('photos-source.rename-save')
		save.dispatchEvent(new MouseEvent('mousedown', {bubbles: true}))
		save.click()
	})
	expect(mocks.rename.mock.calls[0]?.[0]).toEqual({id: source.id, name: 'Holiday phone'})
	expect(input.disabled).toBe(true)
	expect(button('photos-source.rename-save').disabled).toBe(true)
	act(() => document.body.dispatchEvent(new MouseEvent('mousedown', {bubbles: true})))
	expect(container.querySelector('input')).toBe(input)
	await submit()
	expect(mocks.rename).toHaveBeenCalledOnce()
	await act(async () => {
		finish()
	})
	expect(mocks.refresh).toHaveBeenCalledOnce()
	expect(input.disabled).toBe(true)
	expect(button('photos-source.rename-save').disabled).toBe(true)
	await act(async () => {
		render('Holiday phone')
		finishRefresh()
	})
	expect(container.querySelector('input')).toBeNull()
	expect(container.textContent).toContain('Holiday phone')
})

it.each(['', '   ', '  My iPhone  ', 'a'.repeat(101), 'Bad\0name'])(
	'does not submit a blank, unchanged, or invalid name: %j',
	async (name) => {
		edit()
		type(name)
		expect(button('photos-source.rename-save').disabled).toBe(true)
		await submit()
		expect(mocks.rename).not.toHaveBeenCalled()
	},
)

it.each(['mousedown', 'touchstart'])(
	'%s outside the editor discards the draft and reopening uses the latest server name',
	(eventName) => {
		edit()
		type('Unsaved draft')
		act(() => document.body.dispatchEvent(new Event(eventName, {bubbles: true})))
		expect(container.querySelector('input')).toBeNull()
		expect(container.textContent).toContain('My iPhone')
		expect(mocks.rename).not.toHaveBeenCalled()
		act(() => render('Updated elsewhere'))
		expect(edit().value).toBe('Updated elsewhere')
	},
)

it('keeps the draft available for retry if saving fails', async () => {
	mocks.rename.mockRejectedValueOnce(new Error('Offline'))
	edit()
	type('Holiday phone')
	await submit()
	expect(mocks.error).toHaveBeenCalledWith('photos-source.rename-failed', {area: 'photos'})
	expect(container.querySelector('input')!.value).toBe('Holiday phone')
	expect(button('photos-source.rename-save').disabled).toBe(false)
	await submit()
	expect(mocks.rename).toHaveBeenCalledTimes(2)
})
