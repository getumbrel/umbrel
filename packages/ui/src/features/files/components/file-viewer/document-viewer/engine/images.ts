// Pictures from the package become blob URLs, typed by their bytes rather than their names: an <img> only ever
// gets a format the browser decodes on its own, and anything else (EMF, WMF, unknown data) gets no URL at all. Nor
// does SVG: harmless as an <img>, its blob: URL opened any other way would be a document of our own origin.

import type {DocxPackage} from './package'

function sniffImage(bytes: Uint8Array): string | undefined {
	const at = (offset: number, ...signature: number[]) => signature.every((byte, i) => bytes[offset + i] === byte)
	if (at(0, 0x89, 0x50, 0x4e, 0x47)) return 'image/png'
	if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg'
	if (at(0, 0x47, 0x49, 0x46, 0x38)) return 'image/gif'
	if (at(0, 0x42, 0x4d)) return 'image/bmp'
	if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp'
	if (at(0, 0x49, 0x49, 0x2a, 0x00) || at(0, 0x4d, 0x4d, 0x00, 0x2a)) return 'image/tiff'
	if (at(4, 0x66, 0x74, 0x79, 0x70)) {
		const brand = String.fromCharCode(...bytes.subarray(8, 12))
		if (brand === 'avif' || brand === 'avis') return 'image/avif'
	}
	if (at(0, 0x00, 0x00, 0x01, 0x00)) return 'image/x-icon'
	return undefined
}

// What a document's pictures may take in all, in bytes read: a crafted file can make many parts out of one
// compressed stream, each as large as a part may be. Pictures past it show as empty frames.
const BUDGET = 256 * 2 ** 20

// Blob URLs for the package's pictures, created once each and revoked together. They're read one at a time, which is
// as quick as all at once, so no more than one picture's bytes are held besides the URLs.
export class ImageStore {
	private urls = new Map<string, string>()
	// Each picture is read once: a render begun while an earlier one is still reading it waits for the same read
	private reads = new Map<string, Promise<void>>()
	private queue = Promise.resolve()
	private spent = 0
	private revoked = false
	// Each part's size as its entry declares it, which inflating is held to
	private readonly sizes: Map<string, number>

	constructor(private readonly pkg: DocxPackage) {
		this.sizes = new Map(pkg.archive.entries.map((entry) => [entry.name, entry.size]))
	}

	async load(parts: Iterable<string>): Promise<Map<string, string>> {
		await Promise.all(
			[...parts].map((part) => {
				let reading = this.reads.get(part)
				if (!reading) {
					reading = this.queue = this.queue.then(() => this.read(part))
					this.reads.set(part, reading)
				}
				return reading
			}),
		)
		return this.urls
	}

	revoke() {
		this.revoked = true
		for (const url of this.urls.values()) URL.revokeObjectURL(url)
		this.urls.clear()
		this.reads.clear()
	}

	private async read(part: string) {
		const size = this.sizes.get(part) ?? 0
		// The document is gone, or its pictures have had their share
		if (this.revoked || this.spent + size > BUDGET) return
		this.spent += size
		try {
			const bytes = await this.pkg.bytes(part)
			const type = sniffImage(bytes)
			// Revoked while this was inflating: the document is gone
			if (type && !this.revoked) this.urls.set(part, URL.createObjectURL(new Blob([bytes], {type})))
		} catch {
			// A damaged picture shows as an empty frame, like one we can't decode
		}
	}
}
