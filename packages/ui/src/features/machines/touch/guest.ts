import type {ReactNode} from 'react'

export type CursorShape = 'arrow' | 'ibeam' | 'hand' | 'grabbing'

export type GuestStatus = 'connecting' | 'connected' | 'reconnecting' | 'superseded'

// Decides what the keys say and which are worth having
export type GuestFamily = 'windows' | 'linux' | 'android'

// What the console needs from a machine, which is exactly what VNC offers: an
// absolute pointer with a button mask, wheel ticks and keysyms going in, and
// pixels and a cursor image coming back.
export interface Guest {
	width: number
	height: number
	x: number
	y: number
	cursor: CursorShape
	status: GuestStatus
	// Real guests need time between keystrokes: toolkits debounce
	paced: boolean
	// Android expects a finger, not a mouse: touches pass straight through
	nativeTouch: boolean
	// A text console has no pointer to speak of: touching it means typing
	textOnly: boolean
	family: GuestFamily
	pointer(x: number, y: number, buttons: number): void
	wheel(x: number, y: number, dx: number, dy: number): void
	key(keysym: number, down: boolean): void
	// Text a keystroke can't carry, like an emoji or an accent
	paste?(text: string): void
	caret(): {x: number; y: number} | undefined
	// The pointer moved or the cursor changed shape
	onPointer(listener: () => void): () => void
	// The guest's desktop changed size
	onResize(listener: () => void): () => void
	onStatus(listener: () => void): () => void
	// How large the camera is drawing this guest, so a cursor can stay findable
	setViewScale?(scale: number): void
	// The caret was found somewhere new
	onCaretMove?: () => void
	// Text the guest just copied, to offer to this device
	onClipboard?: (text: string) => void
	retry?(): void
	resizeTo?(width: number, height: number): void
	render(): ReactNode
	// Draws the area around a point for the loupe
	drawLoupe(context: CanvasRenderingContext2D, x: number, y: number, scale: number, size: number): void
}
