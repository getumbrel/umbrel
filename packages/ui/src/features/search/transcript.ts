// What is said in a video or recording, as Search keeps it — one timed entry
// per sentence — and the reading of it that every surface showing a
// transcript shares: which line is being spoken, what a click on one means,
// what the keys do, and how it goes to the clipboard.

export type TranscriptLine = {startMs: number; endMs: number; text: string}

// The line being spoken at `ms`, or the row playback is in (see lyricRows):
// the last one that has started. Before the first, none (−1).
export function activeLine(transcript: readonly {startMs: number}[], ms: number) {
	let active = -1
	for (let index = 0; index < transcript.length && transcript[index]!.startMs <= ms; index++) active = index
	return active
}

// A transcript as text to paste somewhere: the words, a line for each thing
// said, and no times — a note or a message wants what was said, and a time
// on every line is something to delete before the words can be used.
export function transcriptText(transcript: readonly {text: string}[]) {
	return transcript
		.map((line) => line.text.trim())
		.filter(Boolean)
		.join('\n')
}

// How far the pointer may wander between press and release and still have
// clicked: past it, the press was a drag
const DRAG_PX = 4

// Whether a click was the reader taking words rather than asking for
// anything: it ended a drag, or was the second of a double-click (which
// selects a word), and text in `within` is selected for it. A plain click
// while words happen to be selected is still a click — the browser lets the
// selection go a moment after, and the reader should not have to click twice.
export function clickSelectedText(
	click: {detail: number; clientX: number; clientY: number},
	press: {x: number; y: number} | undefined,
	selection: Pick<Selection, 'isCollapsed' | 'anchorNode' | 'focusNode'> | null,
	within: Node,
) {
	if (!selection || selection.isCollapsed) return false
	if (!within.contains(selection.anchorNode) && !within.contains(selection.focusNode)) return false
	const dragged = press !== undefined && Math.hypot(click.clientX - press.x, click.clientY - press.y) > DRAG_PX
	return dragged || click.detail > 1
}

// What a key pressed on line `index` of `count` asks for: the line to move
// focus to (the list is one tab stop, walked with the arrows), to play from
// this one, or nothing. A shortcut is never a command to a line: copying a
// selection must stay copying.
export function transcriptKey(
	event: {key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean},
	index: number,
	count: number,
): {focus: number} | 'play' | undefined {
	if (event.metaKey || event.ctrlKey || event.altKey) return undefined
	const to = {ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: count - 1}[event.key]
	if (to !== undefined) return {focus: Math.min(count - 1, Math.max(0, to))}
	return event.key === 'Enter' || event.key === ' ' ? 'play' : undefined
}

// A transcript laid out to be followed as it plays: its lines, and between
// them the silences long enough to be worth showing as silence — music, a
// pause, the seconds before anyone speaks — so that a line said long ago is
// not left lit as though it were still being said.
export type LyricRow =
	| {type: 'line'; line: number; startMs: number; endMs: number}
	| {type: 'gap'; startMs: number; endMs: number}

// The shortest silence shown as one
const GAP_MS = 3000

export function lyricRows(transcript: readonly TranscriptLine[]): LyricRow[] {
	const rows: LyricRow[] = []
	let spokenUntil = 0
	transcript.forEach((line, index) => {
		if (line.startMs - spokenUntil >= GAP_MS) rows.push({type: 'gap', startMs: spokenUntil, endMs: line.startMs})
		rows.push({type: 'line', line: index, startMs: line.startMs, endMs: Math.max(line.startMs, line.endMs)})
		spokenUntil = Math.max(spokenUntil, line.endMs)
	})
	return rows
}

// How many of a line's `words` have been said `ms` into it. Search times
// sentences, not words, so this is an estimate: speech is taken to move
// through the sentence at an even pace, a word taking as long as it has
// letters. Good to within a word or two — enough to show a line moving,
// never to be shown as exact.
export function wordsSaid(words: readonly string[], row: {startMs: number; endMs: number}, ms: number) {
	const span = row.endMs - row.startMs
	if (ms >= row.endMs || span <= 0) return words.length
	if (ms <= row.startMs) return 0
	// A word has a breath after it, so a run of short words is not rushed
	const lengths = words.map((word) => word.length + 1)
	const total = lengths.reduce((sum, length) => sum + length, 0)
	const reached = ((ms - row.startMs) / span) * total
	let said = 0
	let before = 0
	// Said once playback is into the word, not once it is over
	while (said < words.length && before <= reached) before += lengths[said++]!
	return said
}
