// A tile whose picture is in the air. While the lightbox has an item up —
// flying out of the grid, at rest on the stage, flying home — its tile is
// empty, so the flight reads as the photograph leaving its place and coming
// back to it, not as a second copy growing out of the first.
//
// For the tiles that are elements this is one CSS rule rather than a prop:
// nothing in the grid re-renders, it takes effect in the very frame it is
// set (a takeoff a frame early shows a hole, one a frame late shows the tile
// under the picture's first step), and it holds for a tile that mounts
// afterwards — the lightbox, closed on an item stepped far from where it
// opened, scrolls the grid to a tile that did not exist when it was lifted.
// The canvas's cells are left out of the frame by the renderer (Frame.lifted).
//
// Elsewhere the same photo can be on screen twice — the map has it on a
// marker as well as in its list — and a copy that is not the picture's place
// (`data-item-copy`, never flown to) empties with it, or it would be the
// second copy all the same.
export function createTileLift() {
	let sheet: CSSStyleSheet | undefined
	return {
		set(id: string | undefined) {
			try {
				if (!sheet) {
					if (id === undefined) return
					sheet = new CSSStyleSheet()
					document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
				}
				const value = id === undefined ? undefined : `"${CSS.escape(id)}"`
				sheet.replaceSync(value ? `[data-item-id=${value}], [data-item-copy=${value}] { visibility: hidden }` : '')
			} catch {
				// No constructable stylesheets (Safari before 16.4): the tile
				// simply stays where it is, as it always did
			}
		},
		dispose() {
			if (!sheet) return
			const own = sheet
			document.adoptedStyleSheets = document.adoptedStyleSheets.filter((candidate) => candidate !== own)
			sheet = undefined
		},
	}
}
