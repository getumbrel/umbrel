// Cells on the clipboard the way spreadsheets put them there: tab-separated
// text, a field quoted when it holds a tab, a line break or a quote (Excel's
// own form), and an HTML table beside it for apps that paste tables.

export function toTsv(rows: string[][]): string {
	return rows
		.map((cells) => cells.map((text) => (/[\t\r\n"]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text)).join('\t'))
		.join('\r\n')
}

const escapeHtml = (text: string) =>
	text.replace(/[&<>"]/g, (char) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[char]!)

export function toHtml(rows: string[][]): string {
	const body = rows
		.map(
			(cells) =>
				`<tr>${cells.map((text) => `<td>${escapeHtml(text).replace(/\r\n|\r|\n/g, '<br>')}</td>`).join('')}</tr>`,
		)
		.join('')
	return `<table>${body}</table>`
}

// What another app copied, as rows of cells: tab-separated with quoted fields,
// any kind of line break, and no row after a final one
export function fromTsv(text: string): string[][] {
	const rows: string[][] = []
	let cells: string[] = []
	let i = 0
	for (;;) {
		let cell = ''
		if (text[i] === '"') {
			// A quoted field runs to its closing quote; what follows it, up to the next separator, is kept as written
			let close = i + 1
			for (;;) {
				const quote = text.indexOf('"', close)
				if (quote < 0) {
					close = -1
					break
				}
				if (text[quote + 1] !== '"') {
					close = quote
					break
				}
				close = quote + 2
			}
			if (close >= 0) {
				cell = text.slice(i + 1, close).replaceAll('""', '"')
				i = close + 1
			}
		}
		const end = text.slice(i).search(/[\t\r\n]/)
		const stop = end < 0 ? text.length : i + end
		cell += text.slice(i, stop)
		cells.push(cell)
		if (stop >= text.length) break
		if (text[stop] === '\t') {
			i = stop + 1
			continue
		}
		rows.push(cells)
		cells = []
		i = stop + (text.startsWith('\r\n', stop) ? 2 : 1)
		if (i >= text.length) return rows
	}
	rows.push(cells)
	return rows
}
