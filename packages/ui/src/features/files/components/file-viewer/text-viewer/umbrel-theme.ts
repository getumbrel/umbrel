import {HighlightStyle, syntaxHighlighting} from '@codemirror/language'
import {Extension} from '@codemirror/state'
import {EditorView} from '@codemirror/view'
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
		'&': {
			color: 'rgba(255, 255, 255, 0.75)',
			backgroundColor: 'rgba(0, 0, 0, 0)',
			fontSize: '13px',
			fontFamily: "SF Mono, SFMono-Regular, ui-monospace, 'DejaVu Sans Mono', Menlo, Consolas, monospace",
		},
		'&.cm-editor': {
			backgroundColor: 'transparent',
		},
		'.cm-scroller': {
			backgroundColor: 'transparent',
		},
		'.cm-content': {
			caretColor: 'rgba(255, 255, 255, 0.9)',
			padding: '12px 0',
		},
		'.cm-cursor, .cm-dropCursor': {
			borderLeftColor: 'rgba(255, 255, 255, 0.9)',
			borderLeftWidth: '1.5px',
		},
		'&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
			backgroundColor: 'rgba(255, 255, 255, 0.08)',
		},
		'.cm-activeLine': {
			backgroundColor: 'rgba(255, 255, 255, 0.02)',
		},
		'.cm-gutters': {
			backgroundColor: 'transparent',
			color: 'rgba(255, 255, 255, 0.20)',
			border: 'none',
			paddingLeft: '12px',
		},
		'.cm-activeLineGutter': {
			backgroundColor: 'transparent',
			color: 'rgba(255, 255, 255, 0.40)',
		},
		'.cm-lineNumbers .cm-gutterElement': {
			padding: '0 12px 0 4px',
			minWidth: '40px',
		},
		// Selection highlight for custom search
		'.cm-selectionMatch': {
			backgroundColor: '#facc15',
			color: '#000',
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
		// Scrollbar — match Umbrel's custom scrollbar
		'.cm-scroller::-webkit-scrollbar': {
			width: '11px',
			background: 'transparent',
		},
		'.cm-scroller::-webkit-scrollbar-thumb': {
			border: '4px solid transparent',
			borderRadius: '20px',
			backgroundClip: 'padding-box',
			backgroundColor: 'rgba(255, 255, 255, 0.15)',
		},
		'.cm-scroller::-webkit-scrollbar-thumb:hover': {
			backgroundColor: 'rgba(255, 255, 255, 0.30)',
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
	{tag: tags.comment, color: 'rgba(255, 255, 255, 0.25)', fontStyle: 'italic'},
	{tag: tags.variableName, color: 'rgba(255, 255, 255, 0.75)'},
	{tag: tags.bracket, color: 'rgba(255, 255, 255, 0.35)'},
	{tag: tags.tagName, color: '#9ccfd8'},
	{tag: tags.attributeName, color: '#f6c177'},
	{tag: tags.attributeValue, color: '#a6da95'},
	{tag: tags.propertyName, color: '#9ccfd8'},
	{tag: tags.bool, color: '#c4a7e7'},
	{tag: tags.null, color: '#c4a7e7'},
	{tag: tags.className, color: '#f6c177'},
	{tag: tags.function(tags.variableName), color: '#9ccfd8'},
	{tag: tags.url, color: '#9ccfd8', textDecoration: 'underline'},
	{tag: tags.heading, color: 'rgba(255, 255, 255, 0.90)', fontWeight: 'bold'},
	{tag: tags.emphasis, fontStyle: 'italic'},
	{tag: tags.strong, fontWeight: 'bold', color: 'rgba(255, 255, 255, 0.90)'},
	{tag: tags.link, color: '#9ccfd8'},
	{tag: tags.processingInstruction, color: 'rgba(255, 255, 255, 0.25)'},
	{tag: tags.punctuation, color: 'rgba(255, 255, 255, 0.30)'},
	{tag: tags.separator, color: 'rgba(255, 255, 255, 0.30)'},
	{tag: tags.labelName, color: '#9ccfd8'},
])

export const umbrelTheme: Extension = [umbrelEditorTheme, syntaxHighlighting(umbrelHighlightStyle)]
