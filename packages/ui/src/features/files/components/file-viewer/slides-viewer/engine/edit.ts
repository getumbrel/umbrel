// Editing text in place. A rendered slide's text bodies become editable; after every input the paragraphs are
// read back from the DOM into each run's new text, and saving splices just those texts into the slide part and
// patches it into the package. Paragraphs can't be split or joined and formatting can't change, so the structure
// of every part survives a save, and a save is exactly the typed words.

import {asUtf8} from '@/features/files/components/file-viewer/shared/opc'
import {escapeXmlText} from '@/features/files/components/file-viewer/shared/xml'
import type {EditableParagraph, Splice} from '@/features/files/components/file-viewer/slides-viewer/engine/model'
import type {Package} from '@/features/files/components/file-viewer/slides-viewer/engine/package'
import {
	fixed,
	rendered,
	type Overlay,
	type RenderedParagraph,
	type RenderedSlide,
} from '@/features/files/components/file-viewer/slides-viewer/engine/render'

type Body = RenderedSlide['bodies'][number]

export class Editor {
	// Unsaved text by slide part, then paragraph key: each run's new text, then a new run's text for each stretch
	private pending = new Map<string, Map<number, readonly string[]>>()
	private listening = new Map<HTMLElement, AbortController>()
	private saving: Promise<unknown> = Promise.resolve()

	constructor(
		private pkg: Package,
		// The slide part's current editable paragraphs, rebuilt after each save
		private paragraphsOf: (part: string) => EditableParagraph[],
		// Told which parts a save rewrote, so their slides are rebuilt from the new text
		private invalidate: (part: string) => void,
	) {}

	texts(part: string): Overlay {
		return (key) => this.pending.get(part)?.get(key)
	}

	setEditable(element: HTMLElement, part: string, editable: boolean) {
		this.listening.get(element)?.abort()
		this.listening.delete(element)
		const slide = rendered.get(element)
		if (!slide) return
		for (const body of slide.bodies) {
			if (editable) makeEditable(body.element)
			else body.element.removeAttribute('contenteditable')
		}
		if (!editable) return
		const controller = new AbortController()
		this.listening.set(element, controller)
		for (const body of slide.bodies) {
			body.element.addEventListener('beforeinput', (event) => guard(event as InputEvent, body), {
				signal: controller.signal,
			})
			body.element.addEventListener('input', () => this.read(part, body), {signal: controller.signal})
		}
	}

	isDirty() {
		for (const edits of this.pending.values()) if (edits.size) return true
		return false
	}

	// Saves the text as it is now; a save still writing finishes first, and what's typed meanwhile waits
	save(): Promise<Uint8Array> {
		const snapshot = [...this.pending].map(([part, edits]) => [part, new Map(edits)] as const)
		const save = this.saving.then(() => this.write(snapshot))
		// The next save waits for this one without holding on to the package it wrote
		this.saving = save.then(
			() => {},
			() => {},
		)
		return save
	}

	destroy() {
		for (const controller of this.listening.values()) controller.abort()
		this.listening.clear()
		this.pending.clear()
	}

	// Records how a body's paragraphs differ from the saved text
	private read(part: string, body: Body) {
		const paragraphs = this.paragraphsOf(part)
		let edits = this.pending.get(part)
		for (const paragraph of body.paragraphs) {
			const model = paragraphs[paragraph.key]
			if (!model) continue
			const texts = readParagraph(paragraph, model.runs.length, model.gaps.length)
			const base = [...model.runs.map((run) => run.text), ...model.gaps.map(() => '')]
			if (texts.every((text, i) => text === base[i])) {
				edits?.delete(paragraph.key)
			} else {
				if (!edits) this.pending.set(part, (edits = new Map()))
				edits.set(paragraph.key, texts)
			}
		}
	}

	private async write(snapshot: ReadonlyArray<readonly [string, Map<number, readonly string[]>]>): Promise<Uint8Array> {
		const changes = new Map<string, string>()
		for (const [part, edits] of snapshot) {
			const text = this.pkg.text(part)
			if (!edits.size || text === undefined) continue
			const paragraphs = this.paragraphsOf(part)
			const splices: Array<Splice & {text: string}> = []
			for (const [key, texts] of edits) {
				const paragraph = paragraphs[key]
				if (!paragraph) continue
				paragraph.runs.forEach((run, i) => {
					if (texts[i] !== undefined && texts[i] !== run.text) splices.push({...run, text: texts[i]})
				})
				paragraph.gaps.forEach((gap, i) => {
					const text = texts[paragraph.runs.length + i]
					if (text) splices.push({...gap, text})
				})
			}
			// From the end backwards, so earlier offsets stay valid
			splices.sort((a, b) => b.start - a.start)
			let next = text
			for (const splice of splices) {
				next =
					next.slice(0, splice.start) +
					splice.before +
					escapeXmlText(splice.text) +
					splice.after +
					next.slice(splice.end)
			}
			changes.set(part, asUtf8(next))
		}
		const bytes = await this.pkg.save(changes)
		for (const part of changes.keys()) this.invalidate(part)
		// What was saved is the new baseline; anything typed during the save stays pending against it
		for (const [part, edits] of snapshot) {
			const current = this.pending.get(part)
			for (const [key, texts] of edits) if (current?.get(key) === texts) current.delete(key)
		}
		return bytes
	}
}

// plaintext-only keeps pasted formatting out where it's supported; older browsers throw on it
const PLAINTEXT = (() => {
	try {
		const probe = document.createElement('div')
		probe.contentEditable = 'plaintext-only'
		return probe.contentEditable === 'plaintext-only'
	} catch {
		return false
	}
})()

function makeEditable(element: HTMLElement) {
	element.setAttribute('contenteditable', PLAINTEXT ? 'plaintext-only' : 'true')
}

// Edits stay inside one paragraph's own text: splitting, joining, formatting, and anything that would swallow a
// bullet, field or line break is refused. Pasted text goes in as one plain line.
function guard(event: InputEvent, body: Body) {
	const type = event.inputType
	// Undo and redo only ever revisit states these rules allowed
	if (type === 'historyUndo' || type === 'historyRedo') return
	if (REFUSED.has(type) || type.startsWith('format')) {
		event.preventDefault()
		return
	}
	const targets = event.getTargetRanges?.() ?? []
	const selection = document.getSelection()
	const caret = selection?.rangeCount ? selection.getRangeAt(0) : undefined
	let allowed = false
	if (targets.length) allowed = targets.every((range) => withinParagraph(range, body))
	// Without target ranges (Chrome gives none when a bullet would go) a collapsed deletion says nothing about
	// what it takes: it may only take text up to the nearest fixed piece or paragraph edge, and never a whole line
	else if (caret?.collapsed && type.startsWith('delete'))
		allowed = !type.includes('Line') && textToward(caret, body, type.endsWith('Backward'))
	else if (caret) allowed = withinParagraph(caret, body)
	if (type === 'insertFromPaste' || type === 'insertFromYank') {
		event.preventDefault()
		const text = (event.dataTransfer?.getData('text/plain') ?? event.data ?? '').replace(/\s*[\r\n]+\s*/g, ' ')
		// execCommand keeps the paste on the browser's own undo stack
		if (allowed && text) document.execCommand('insertText', false, text)
		return
	}
	if (!allowed) event.preventDefault()
}

const REFUSED = new Set(['insertParagraph', 'insertLineBreak', 'insertFromDrop', 'deleteByDrag'])

const insideFixed = (node: Node, paragraph: HTMLElement) => {
	for (let at: Node | null = node; at && at !== paragraph; at = at.parentNode) if (fixed.has(at)) return true
	return false
}

// Whether there's paragraph text next to a collapsed caret on that side before any fixed piece or the edge
function textToward(caret: Range, body: Body, backward: boolean): boolean {
	const paragraph = body.paragraphs.find((p) => p.element.contains(caret.startContainer))?.element
	const {startContainer: container, startOffset: offset} = caret
	if (!paragraph || insideFixed(container, paragraph)) return false
	if (container.nodeType === Node.TEXT_NODE && (backward ? offset > 0 : offset < (container as Text).length))
		return true
	const leaves: Node[] = []
	const collect = (parent: Node) => {
		for (const child of parent.childNodes) {
			if (child.nodeType === Node.TEXT_NODE || fixed.has(child)) leaves.push(child)
			else collect(child)
		}
	}
	collect(paragraph)
	// Leaves wholly on the deletion's side of the caret, nearest first
	const side = leaves.filter((leaf) => leaf !== container && caret.comparePoint(leaf, 0) < 0 === backward)
	for (const leaf of backward ? side.reverse() : side) {
		if (fixed.has(leaf)) return false
		if ((leaf as Text).length) return true
	}
	return false
}

function withinParagraph(range: AbstractRange, body: Body): boolean {
	const paragraph = body.paragraphs.find((p) => p.element.contains(range.startContainer))
	if (!paragraph || !paragraph.element.contains(range.endContainer)) return false
	let live: Range
	try {
		live = document.createRange()
		live.setStart(range.startContainer, range.startOffset)
		live.setEnd(range.endContainer, range.endOffset)
	} catch {
		return false
	}
	for (const node of paragraph.element.querySelectorAll('*')) {
		if (!fixed.has(node)) continue
		if (live.intersectsNode(node) || node.contains(range.startContainer) || node.contains(range.endContainer))
			return false
	}
	return true
}

// A paragraph's text per run, then per stretch between its fields and breaks as a run to add there, read from the
// DOM as the browser left it. Text inside a run's element is that run's. Text the browser put elsewhere (after
// deleting a run's element, say) stays between the same fixed pieces: it joins the nearest run there, or a run
// whose element went missing there, or else a run to add there. Text before the bullet, or after the spacer that
// gives a last empty line its height, is in the stretch beside it.
function readParagraph(paragraph: RenderedParagraph, count: number, gaps: number): string[] {
	const owners = new Map<Node, number>(paragraph.runs.map((run, i) => [run, i]))
	const pieces: Array<{run: number | undefined; stretch: number; text: string}> = []
	const first = paragraph.offset
	const last = first + gaps - 1
	let stretch = 0
	const walk = (node: Node, owner: number | undefined) => {
		for (const child of node.childNodes) {
			if (child.nodeType === Node.TEXT_NODE)
				pieces.push({run: owner, stretch: Math.min(Math.max(stretch, first), last), text: (child as Text).data})
			else if (child.nodeType === Node.ELEMENT_NODE) {
				if (fixed.has(child)) stretch++
				else walk(child, owners.get(child) ?? owner)
			}
		}
	}
	walk(paragraph.element, undefined)
	const own = (i: number) => {
		const run = pieces[i]?.run
		return run !== undefined && run < count ? run : undefined
	}
	const nearest = (i: number) => {
		for (const step of [-1, 1]) {
			for (let j = i + step; j >= 0 && j < pieces.length; j += step) {
				if (pieces[j].stretch !== pieces[i].stretch) break
				const run = own(j)
				if (run !== undefined) return run
			}
		}
		return undefined
	}
	const home = (i: number) => {
		const run = paragraph.stretches.findIndex((s, r) => s === pieces[i].stretch && r < count)
		return run < 0 ? undefined : run
	}
	const texts = Array.from({length: count + gaps}, () => '')
	pieces.forEach((piece, i) => {
		texts[own(i) ?? nearest(i) ?? home(i) ?? count + piece.stretch - first] += piece.text
	})
	// A run can't hold a line break; one that slipped in reads as a space
	return texts.map((text) => text.replace(/\r\n?|\n/g, ' '))
}
