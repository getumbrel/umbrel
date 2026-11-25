import {HighlightStyle, syntaxHighlighting} from '@codemirror/language'
import {Extension} from '@codemirror/state'
import {EditorView, ViewPlugin, type ViewUpdate} from '@codemirror/view'
import {tags} from '@lezer/highlight'

// Umbrel glassmorphic dark theme for CodeMirror 6
// Matches Umbrel's actual design language: transparent backgrounds, blur,
// inset highlights, and the white-opacity text hierarchy system.
// The editor background is transparent so the parent container's
// backdrop-blur and glassmorphic styling shows through.

const umbrelEditorTheme = EditorView.theme(
	{
		// Force dark background on every CodeMirror layer — the wrapper div,
		// the editor root, and the scroller all need explicit bg to prevent
		// the library's default white from bleeding through.
		// The whites the editor draws in, each a step stronger with Increase contrast, as the app's own text is
		'&': {
			'--cm-umbrel-text': 'rgba(255, 255, 255, 0.75)',
			'--cm-umbrel-strong': 'rgba(255, 255, 255, 0.90)',
			'--cm-umbrel-gutter': 'rgba(255, 255, 255, 0.20)',
			'--cm-umbrel-gutter-active': 'rgba(255, 255, 255, 0.40)',
			'--cm-umbrel-comment': 'rgba(255, 255, 255, 0.25)',
			'--cm-umbrel-punctuation': 'rgba(255, 255, 255, 0.30)',
			'--cm-umbrel-bracket': 'rgba(255, 255, 255, 0.35)',
			'--cm-umbrel-selection': 'rgba(255, 255, 255, 0.08)',
			color: 'var(--cm-umbrel-text)',
			backgroundColor: 'rgba(0, 0, 0, 0)',
			fontSize: 'calc(13px + var(--text-boost))',
			fontFamily: "SF Mono, SFMono-Regular, ui-monospace, 'DejaVu Sans Mono', Menlo, Consolas, monospace",
		},
		'[data-increase-contrast] &': {
			'--cm-umbrel-text': 'rgba(255, 255, 255, 0.85)',
			'--cm-umbrel-strong': '#fff',
			'--cm-umbrel-gutter': 'rgba(255, 255, 255, 0.7)',
			'--cm-umbrel-gutter-active': '#fff',
			'--cm-umbrel-comment': 'rgba(255, 255, 255, 0.7)',
			'--cm-umbrel-punctuation': 'rgba(255, 255, 255, 0.7)',
			'--cm-umbrel-bracket': 'rgba(255, 255, 255, 0.7)',
			'--cm-umbrel-selection': 'rgba(255, 255, 255, 0.25)',
		},
		'&.cm-editor': {
			backgroundColor: 'transparent',
		},
		'.cm-scroller': {
			backgroundColor: 'transparent',
		},
		'.cm-content': {
			caretColor: 'var(--cm-umbrel-strong)',
			padding: '12px 0',
			// See clipUnderGutters
			clipPath: 'inset(0 0 0 var(--cm-umbrel-scrolled, 0px))',
		},
		// The selection and caret are drawn on layers of no size at the scrolled text's corner, so their clip reaches as
		// far right and down as layout goes
		'.cm-layer': {
			clipPath: 'inset(0 -1e8px -1e8px calc(var(--cm-umbrel-scrolled, 0px) + var(--cm-umbrel-gutters, 0px)))',
		},
		'.cm-cursor, .cm-dropCursor': {
			borderLeftColor: 'var(--cm-umbrel-strong)',
			borderLeftWidth: '1.5px',
		},
		'&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
			backgroundColor: 'var(--cm-umbrel-selection)',
		},
		'.cm-activeLine': {
			backgroundColor: 'rgba(255, 255, 255, 0.02)',
		},
		'.cm-gutters': {
			backgroundColor: 'transparent',
			color: 'var(--cm-umbrel-gutter)',
			border: 'none',
			paddingLeft: '12px',
		},
		'.cm-activeLineGutter': {
			backgroundColor: 'transparent',
			color: 'var(--cm-umbrel-gutter-active)',
		},
		'.cm-lineNumbers .cm-gutterElement': {
			padding: '0 12px 0 4px',
			minWidth: '40px',
		},
		// Other occurrences of the selected text: a quiet echo, never mistaken for find's marks
		'.cm-selectionMatch': {
			backgroundColor: 'rgba(255, 255, 255, 0.12)',
			borderRadius: '2px',
		},
		// Tooltip — glass card style
		'.cm-tooltip': {
			backgroundColor: 'rgba(30, 30, 30, 0.90)',
			backdropFilter: 'blur(20px)',
			border: '0.5px solid rgba(255, 255, 255, 0.08)',
			borderRadius: '10px',
			boxShadow: '0px 20px 36px 0px rgba(0, 0, 0, 0.25), 0px 1px 1px 0px rgba(255, 255, 255, 0.1) inset',
			padding: '4px',
		},
		// Lint — subtle underlines, not aggressive
		'.cm-lintRange-error': {
			backgroundImage: 'none',
			textDecoration: 'underline wavy rgba(224, 62, 62, 0.6)',
			textUnderlineOffset: '3px',
		},
		'.cm-lintRange-warning': {
			backgroundImage: 'none',
			textDecoration: 'underline wavy rgba(245, 158, 11, 0.5)',
			textUnderlineOffset: '3px',
		},
		// Diagnostics panel — glass style
		'.cm-diagnostic': {
			padding: '6px 10px',
			borderRadius: '6px',
		},
		'.cm-diagnostic-error': {
			borderLeft: '2px solid rgba(224, 62, 62, 0.7)',
			backgroundColor: 'rgba(224, 62, 62, 0.05)',
		},
		'.cm-diagnostic-warning': {
			borderLeft: '2px solid rgba(245, 158, 11, 0.5)',
			backgroundColor: 'rgba(245, 158, 11, 0.05)',
		},
		// Focus ring — invisible (we handle focus at container level)
		'&.cm-focused': {
			outline: 'none',
		},
	},
	{dark: true},
)

// Syntax highlighting — muted, elegant colors that don't fight the glass aesthetic.
// Avoid bright saturated colors that feel out of place on the glassmorphic surface.
const umbrelHighlightStyle = HighlightStyle.define([
	{tag: tags.keyword, color: '#c4a7e7'},
	{tag: tags.operator, color: '#9ccfd8'},
	{tag: tags.special(tags.variableName), color: '#eb6f92'},
	{tag: tags.typeName, color: '#f6c177'},
	{tag: tags.atom, color: '#c4a7e7'},
	{tag: tags.number, color: '#ebbcba'},
	{tag: tags.definition(tags.variableName), color: '#9ccfd8'},
	{tag: tags.string, color: '#a6da95'},
	{tag: tags.special(tags.string), color: '#a6da95'},
	{tag: tags.comment, color: 'var(--cm-umbrel-comment)', fontStyle: 'italic'},
	{tag: tags.variableName, color: 'var(--cm-umbrel-text)'},
	{tag: tags.bracket, color: 'var(--cm-umbrel-bracket)'},
	{tag: tags.tagName, color: '#9ccfd8'},
	{tag: tags.attributeName, color: '#f6c177'},
	{tag: tags.attributeValue, color: '#a6da95'},
	{tag: tags.propertyName, color: '#9ccfd8'},
	{tag: tags.bool, color: '#c4a7e7'},
	{tag: tags.null, color: '#c4a7e7'},
	{tag: tags.className, color: '#f6c177'},
	{tag: tags.function(tags.variableName), color: '#9ccfd8'},
	{tag: tags.url, color: '#9ccfd8', textDecoration: 'underline'},
	{tag: tags.heading, color: 'var(--cm-umbrel-strong)', fontWeight: 'bold'},
	{tag: tags.emphasis, fontStyle: 'italic'},
	{tag: tags.strong, fontWeight: 'bold', color: 'var(--cm-umbrel-strong)'},
	{tag: tags.link, color: '#9ccfd8'},
	{tag: tags.processingInstruction, color: 'var(--cm-umbrel-comment)'},
	{tag: tags.punctuation, color: 'var(--cm-umbrel-punctuation)'},
	{tag: tags.separator, color: 'var(--cm-umbrel-punctuation)'},
	{tag: tags.labelName, color: '#9ccfd8'},
])

// The gutters have no background, so the card's glass shows through them, and a long line scrolled sideways would show
// through them too: the text, and the selection and caret over it, are cut off where the gutters end instead
const clipUnderGutters = ViewPlugin.fromClass(
	class {
		clip = {scrolled: 0, gutters: 0}
		measure = {
			read: (view: EditorView) => ({scrolled: view.scrollDOM.scrollLeft, gutters: view.contentDOM.offsetLeft}),
			write: (clip: {scrolled: number; gutters: number}, view: EditorView) => {
				if (clip.scrolled === this.clip.scrolled && clip.gutters === this.clip.gutters) return
				this.clip = clip
				view.scrollDOM.style.setProperty('--cm-umbrel-scrolled', `${clip.scrolled}px`)
				view.scrollDOM.style.setProperty('--cm-umbrel-gutters', `${clip.gutters}px`)
			},
		}
		constructor(view: EditorView) {
			view.requestMeasure(this.measure)
		}
		// The gutters widen as the line numbers gain a digit
		update(update: ViewUpdate) {
			if (update.geometryChanged) update.view.requestMeasure(this.measure)
		}
	},
	{
		eventHandlers: {
			scroll(_event, view) {
				view.requestMeasure(this.measure)
			},
		},
	},
)

export const umbrelTheme: Extension = [umbrelEditorTheme, syntaxHighlighting(umbrelHighlightStyle), clipUnderGutters]
