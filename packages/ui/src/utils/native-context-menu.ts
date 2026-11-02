// Input types that edit text. Anything else (checkbox, range, file…) has no text to copy or paste.
const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url', 'tel', 'email', 'password', 'number'])

// umbrelOS suppresses the browser's context menu for a native OS feel, but text editing belongs to the
// browser: its menu is the only paste path over plain HTTP, where `navigator.clipboard` doesn't exist, and
// it carries spellcheck suggestions and password-manager entries a custom menu can't. Text fields keep it,
// and so does anything marked `data-native-context-menu`, like the terminal and the log viewers.
export function allowsNativeContextMenu(target: EventTarget | null) {
	if (!(target instanceof Element)) return false
	if (target instanceof HTMLTextAreaElement) return true
	if (target instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(target.type)
	return target.closest('[contenteditable]:not([contenteditable="false"]), [data-native-context-menu]') !== null
}
