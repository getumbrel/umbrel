// Our own PowerPoint engine: reads a .pptx into render-ready slides (DOM + inline SVG), their speaker notes, and
// saves text edits by splicing the changed runs into their slide parts, leaving every other byte of the package
// as it was. See slide.ts for inheritance, render.ts for drawing and edit.ts for editing.

import {
	attr,
	child,
	children,
	textContent,
	tokenizeXml,
	type XmlElement,
} from '@/features/files/components/file-viewer/shared/xml'
import {EMU_PER_PX} from '@/features/files/components/file-viewer/slides-viewer/engine/drawing'
import {Editor} from '@/features/files/components/file-viewer/slides-viewer/engine/edit'
import type {SlideModel} from '@/features/files/components/file-viewer/slides-viewer/engine/model'
import {
	Package,
	PresentationError,
	translate,
} from '@/features/files/components/file-viewer/slides-viewer/engine/package'
import {Images, PICTURE_TYPES, renderSlide} from '@/features/files/components/file-viewer/slides-viewer/engine/render'
import {buildSlide, type Deck} from '@/features/files/components/file-viewer/slides-viewer/engine/slide'

export {
	PresentationError,
	type PresentationErrorCode,
} from '@/features/files/components/file-viewer/slides-viewer/engine/package'

// Content the slides contain but only approximate: charts are drawn as titled frames, video and audio as their
// poster frame, embedded objects as their preview picture, and some picture formats (EMF, WMF, TIFF…) not at all
export type Approximated = 'charts' | 'media' | 'objects' | 'pictures'

export type Presentation = {
	// CSS px at 96 dpi
	slideSize: {width: number; height: number}
	slideCount: number
	// A fixed-size element with the slide drawn inside, positioned absolutely; scale it with a CSS transform.
	// Pictures fill in as they decode.
	renderSlide(index: number): HTMLElement
	// Hidden slides are skipped by slide shows
	isHidden(index: number): boolean
	// The speaker notes, paragraphs separated by newlines
	notes(index: number): string
	approximated: ReadonlySet<Approximated>
	// Makes the text of a rendered slide editable in place (or not). Only words change: paragraphs can't be split
	// or joined and formatting stays as it is.
	setEditable(index: number, slideElement: HTMLElement, editable: boolean): void
	isDirty(): boolean
	// The edited package, in a buffer that's the caller's. Its text becomes the baseline isDirty() compares against.
	save(): Promise<Uint8Array>
	destroy(): void
}

const MAX_SLIDES = 10000
// Slide models kept at once; others rebuild from their text in a few milliseconds when drawn again
const MAX_MODELS = 48

type Slide = {part: string; hidden: boolean; notes?: string}

export async function openPresentation(bytes: Uint8Array): Promise<Presentation> {
	const loaded = await loadPresentation(bytes)
	const {pkg, slides} = loaded
	const images = new Images(pkg)
	const editor = new Editor(
		pkg,
		(part) => {
			const index = slides.findIndex((slide) => slide.part === part)
			return index < 0 ? [] : loaded.model(index).paragraphs
		},
		loaded.invalidate,
	)
	let destroyed = false
	const slideAt = (index: number) => {
		if (destroyed) throw new Error('The presentation was destroyed')
		const slide = slides[index]
		if (!slide) throw new RangeError(`No slide ${index}`)
		return slide
	}

	return {
		slideSize: loaded.slideSize,
		slideCount: slides.length,
		renderSlide(index) {
			const {part} = slideAt(index)
			return renderSlide(loaded.model(index), loaded.slideSize, images, editor.texts(part))
		},
		isHidden: (index) => slideAt(index).hidden,
		notes(index) {
			slideAt(index)
			return loaded.notes(index)
		},
		approximated: loaded.approximated,
		setEditable(index, element, editable) {
			// Destroying let go of every slide's listeners already. A UI tearing down destroys the deck and then
			// lets go of its slides (React cleans a parent up before its children), so that's harmless.
			if (destroyed && !editable) return
			editor.setEditable(element, slideAt(index).part, editable)
		},
		isDirty: () => editor.isDirty(),
		async save() {
			if (destroyed) throw new Error('The presentation was destroyed')
			try {
				return await editor.save()
			} catch (error) {
				throw translate(error)
			}
		},
		destroy() {
			destroyed = true
			images.revoke()
			editor.destroy()
		},
	}
}

// Reads the package and everything the slides need; slide models are built on first use. Drawing and editing
// are layered on by openPresentation; tests read the models directly.
export async function loadPresentation(bytes: Uint8Array) {
	const pkg = await Package.open(bytes)
	// Packages that lost their root relationships still keep the presentation where PowerPoint puts it
	const main =
		pkg.related('', 'officeDocument') ?? (pkg.has('ppt/presentation.xml') ? 'ppt/presentation.xml' : undefined)
	if (!main) throw new PresentationError('corrupt', 'The package has no presentation')
	await pkg.load([main])
	const root = pkg.xml(main)
	if (!root || root.local !== 'presentation')
		throw new PresentationError('unsupported', 'Not a PowerPoint presentation')

	const list = child(root, 'sldIdLst')
	const parts = (list ? children(list, 'sldId') : [])
		.map((sldId) => pkg.target(main, relationshipId(sldId)))
		.filter((part) => part !== undefined && pkg.has(part))
		.slice(0, MAX_SLIDES) as string[]
	if (!parts.length) throw new PresentationError('corrupt', 'The presentation has no slides')

	// Everything slides render from is read now, since rendering is synchronous
	await pkg.load(parts)
	const related = (sources: string[], types: string[]) =>
		sources.flatMap((part) =>
			[...pkg.rels(part).values()].filter((rel) => !rel.external && types.includes(rel.type)).map((rel) => rel.target),
		)
	await pkg.load([
		...related(parts, ['slideLayout', 'notesSlide', 'chart', 'diagramData', 'diagramDrawing']),
		...related([main], ['tableStyles']),
	])
	const layouts = related(parts, ['slideLayout'])
	const masters = related(layouts, ['slideMaster'])
	await pkg.load(masters)
	await pkg.load(related(masters, ['theme']))

	const deck: Deck = {
		pkg,
		defaultTextStyle: child(root, 'defaultTextStyle'),
		tableStyles: new Map(),
		masters: new Map(),
		layouts: new Map(),
	}
	const tableStylesPart = pkg.related(main, 'tableStyles')
	const tableStyles = tableStylesPart ? recover(() => pkg.xml(tableStylesPart)) : undefined
	for (const style of tableStyles ? children(tableStyles, 'tblStyle') : []) {
		const id = attr(style, 'styleId')
		if (id) deck.tableStyles.set(id.toUpperCase(), style)
	}

	const size = child(root, 'sldSz')
	const dimension = (name: string, fallback: number) => {
		const value = Number((size && attr(size, name)) ?? fallback) / EMU_PER_PX
		return Number.isFinite(value) && value >= 1 && value <= 20000 ? value : fallback / EMU_PER_PX
	}
	const firstNumber = Math.floor(Number(attr(root, 'firstSlideNum') ?? 1)) || 1
	const slides: Slide[] = parts.map((part) => ({part, hidden: isHidden(pkg.text(part) ?? '')}))
	// Most recently used last
	const models = new Map<number, SlideModel>()
	return {
		pkg,
		slides,
		slideSize: {width: dimension('cx', 12192000), height: dimension('cy', 6858000)},
		approximated: approximations(pkg, [...parts, ...layouts, ...masters]),
		model(index: number): SlideModel {
			let model = models.get(index)
			if (model) models.delete(index)
			else {
				const {part} = slides[index]
				// A slide whose parts are broken is drawn empty rather than taking the whole deck down
				model = recover(() => buildSlide(deck, part, firstNumber + index)) ?? {elements: [], paragraphs: []}
				// The model holds everything drawing and saving need: the parsed tree can go
				pkg.release(part)
				if (models.size >= MAX_MODELS) models.delete(models.keys().next().value!)
			}
			models.set(index, model)
			return model
		},
		// A saved part's slides rebuild from its new text on next use
		invalidate(part: string) {
			slides.forEach((slide, index) => slide.part === part && models.delete(index))
		},
		notes(index: number): string {
			const slide = slides[index]
			if (slide.notes === undefined) {
				slide.notes = recover(() => notesOf(pkg, slide.part, firstNumber + index)) ?? ''
				const part = pkg.related(slide.part, 'notesSlide')
				if (part) pkg.release(part)
			}
			return slide.notes
		},
	}
}

// A slide's show="0" sits on its root element, so only the first tag needs reading
function isHidden(text: string) {
	let hidden = false
	try {
		tokenizeXml(text, (event) => {
			if (event.type === 'open') hidden = event.attributes.show === '0' || event.attributes.show === 'false'
			return false
		})
	} catch {
		return false
	}
	return hidden
}

// sldId's own `id` is a number; the relationship is the prefixed attribute with the same local name
function relationshipId(sldId: XmlElement) {
	for (const [name, value] of Object.entries(sldId.attributes))
		if (name.endsWith(':id') && !name.startsWith('xmlns')) return value
	return undefined
}

// The notes slide's body placeholder, one line per paragraph
function notesOf(pkg: Package, slidePart: string, slideNumber: number): string {
	const part = pkg.related(slidePart, 'notesSlide')
	const root = part && pkg.xml(part)
	const sld = root && child(root, 'cSld')
	const tree = sld && child(sld, 'spTree')
	for (const sp of tree ? children(tree, 'sp') : []) {
		const nv = child(sp, 'nvSpPr')
		const nvPr = nv && child(nv, 'nvPr')
		const ph = nvPr && child(nvPr, 'ph')
		if (!ph || attr(ph, 'type') !== 'body') continue
		const body = child(sp, 'txBody')
		return (body ? children(body, 'p') : [])
			.map((p) =>
				children(p)
					.map((node) => {
						if (node.local === 'br') return '\n'
						if (node.local === 'fld' && attr(node, 'type') === 'slidenum') return String(slideNumber)
						const t = (node.local === 'r' || node.local === 'fld') && child(node, 't')
						return t ? textContent(t) : ''
					})
					.join(''),
			)
			.join('\n')
			.trim()
	}
	return ''
}

function approximations(pkg: Package, parts: string[]): Set<Approximated> {
	const found = new Set<Approximated>()
	for (const part of parts) {
		let pictures: Set<string> | undefined
		for (const [id, {type, target, external}] of pkg.rels(part)) {
			if (type === 'chart' || type === 'chartEx') found.add('charts')
			else if (type === 'video' || type === 'audio' || type === 'media') found.add('media')
			else if (type === 'oleObject' || type === 'package') found.add('objects')
			else if (
				type === 'image' &&
				!external &&
				!PICTURE_TYPES.test(pkg.contentType(target)) &&
				(pictures ??= pictureIds(pkg.text(part) ?? '')).has(id)
			)
				found.add('pictures')
		}
	}
	return found
}

// The relationships a part's pictures (a:blip) draw from. An svgBlip beside a blip isn't a picture of its own: the
// blip holds Office's PNG rendering of the SVG, which is what's drawn, so the SVG's relationship alone costs nothing.
function pictureIds(text: string): Set<string> {
	const ids = new Set<string>()
	try {
		tokenizeXml(text, (event) => {
			if (event.type !== 'open' || event.name.slice(event.name.indexOf(':') + 1) !== 'blip') return
			for (const [name, value] of Object.entries(event.attributes))
				if (name === 'embed' || name.endsWith(':embed')) ids.add(value)
		})
	} catch {
		// A part that doesn't parse draws nothing
	}
	return ids
}

// Broken or oversized XML in one part costs that part, not the deck; anything else is a bug and propagates
function recover<T>(run: () => T): T | undefined {
	try {
		return run()
	} catch (error) {
		if (error instanceof PresentationError) return undefined
		throw error
	}
}
