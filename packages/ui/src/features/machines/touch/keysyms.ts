// X11 keysyms, the same numbers noVNC's rfb.sendKey takes, so the concept's key
// handling ports straight onto the real console
export const XK = {
	BackSpace: 0xff08,
	Tab: 0xff09,
	Return: 0xff0d,
	Escape: 0xff1b,
	Delete: 0xffff,
	Home: 0xff50,
	Left: 0xff51,
	Up: 0xff52,
	Right: 0xff53,
	Down: 0xff54,
	PageUp: 0xff55,
	PageDown: 0xff56,
	End: 0xff57,
	Insert: 0xff63,
	Print: 0xff61,
	F1: 0xffbe,
	Shift: 0xffe1,
	Control: 0xffe3,
	Alt: 0xffe9,
	Super: 0xffeb,
} as const

export const functionKey = (n: number) => XK.F1 + n - 1

export function charKeysym(character: string) {
	const code = character.codePointAt(0) ?? 0
	return code < 0x100 ? code : 0x01000000 + code
}

export function keysymChar(keysym: number) {
	if (keysym >= 0x20 && keysym <= 0xff) return String.fromCharCode(keysym)
	if (keysym >= 0x01000000) return String.fromCodePoint(keysym - 0x01000000)
}
