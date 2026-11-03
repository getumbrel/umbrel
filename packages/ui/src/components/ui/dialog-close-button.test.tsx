// @vitest-environment jsdom

import {act, useState, type ReactNode} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

import {ImmersiveDialogProvider} from '@/providers/immersive-dialog'

import {AlertDialog, AlertDialogContent, AlertDialogTitle} from './alert-dialog'
import {Dialog, DialogContent, DialogScrollableContent, DialogTitle} from './dialog'
import {ImmersiveDialog, ImmersiveDialogContent, ImmersiveDialogSplitContent} from './immersive-dialog'
import {Sheet, SheetContent, SheetTitle} from './sheet'

vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}))
vi.mock('@/providers/wallpaper', () => ({useWallpaper: () => ({wallpaper: {}})}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const title = <DialogTitle>Window</DialogTitle>

function Plain({closeButton}: {closeButton?: boolean}) {
	const [open, setOpen] = useState(true)
	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogContent closeButton={closeButton}>{title}</DialogContent>
		</Dialog>
	)
}

function Scrollable({closeButton}: {closeButton?: boolean}) {
	const [open, setOpen] = useState(true)
	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogScrollableContent closeButton={closeButton}>{title}</DialogScrollableContent>
		</Dialog>
	)
}

function Immersive() {
	const [open, setOpen] = useState(true)
	return (
		<ImmersiveDialog open={open} onOpenChange={setOpen}>
			<ImmersiveDialogContent>{title}</ImmersiveDialogContent>
		</ImmersiveDialog>
	)
}

function Split() {
	const [open, setOpen] = useState(true)
	return (
		<ImmersiveDialog open={open} onOpenChange={setOpen}>
			<ImmersiveDialogSplitContent side={null}>{title}</ImmersiveDialogSplitContent>
		</ImmersiveDialog>
	)
}

function WindowSheet() {
	const [open, setOpen] = useState(true)
	return (
		<Sheet open={open} onOpenChange={setOpen} modal={false}>
			<SheetContent>
				<SheetTitle>Window</SheetTitle>
			</SheetContent>
		</Sheet>
	)
}

describe('window close button', () => {
	let container: HTMLDivElement
	let root: Root

	beforeEach(() => {
		vi.stubGlobal(
			'ResizeObserver',
			class {
				observe() {}
				unobserve() {}
				disconnect() {}
			},
		)
		container = document.createElement('div')
		document.body.appendChild(container)
		root = createRoot(container)
	})

	afterEach(async () => {
		await act(async () => root.unmount())
		container.remove()
		vi.unstubAllGlobals()
	})

	const mount = async (node: ReactNode) => {
		await act(async () => root.render(<ImmersiveDialogProvider>{node}</ImmersiveDialogProvider>))
		await act(async () => {})
	}
	const closes = () =>
		[...document.querySelectorAll<HTMLElement>('[role="dialog"] button')].filter(
			(button) => button.textContent === 'close',
		)

	const windows = [
		['DialogContent', Plain, 'modal'],
		['DialogScrollableContent', Scrollable, 'modal'],
		['ImmersiveDialogContent', Immersive, 'immersive'],
		['ImmersiveDialogSplitContent', Split, 'immersive'],
		['SheetContent', WindowSheet, 'sheet'],
	] as const

	test.each(windows)('%s draws one close, which closes it', async (_name, Window, surface) => {
		await mount(<Window />)
		expect(closes()).toHaveLength(1)
		expect(closes()[0].dataset.closeSurface).toBe(surface)

		await act(async () => closes()[0].click())
		expect(document.querySelector('[role="dialog"]')).toBeNull()
	})

	test.each([
		['DialogContent', Plain],
		['DialogScrollableContent', Scrollable],
	] as const)('%s can drop it for a busy state', async (_name, Window) => {
		await mount(<Window closeButton={false} />)
		expect(document.querySelector('[role="dialog"]')).not.toBeNull()
		expect(closes()).toHaveLength(0)
	})

	test('an AlertDialog never has one: its buttons decide', async () => {
		await mount(
			<AlertDialog open>
				<AlertDialogContent>
					<AlertDialogTitle>Sure?</AlertDialogTitle>
				</AlertDialogContent>
			</AlertDialog>,
		)
		expect(document.querySelector('[role="dialog"]')).not.toBeNull()
		expect(document.querySelectorAll('[data-close-surface]')).toHaveLength(0)
	})
})
