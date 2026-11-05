// pdf.js imports its JavaScript decoders for fax, JBIG2 and JPEG 2000 images
// (most scans) by file name from the directory it is given as `wasmUrl`. The
// build fingerprints those names, so `wasmUrl` is this module with each
// name's real URL in its query (see pdfjs.ts): pdf.js appends the name it
// wants, and this hands back that module. A query, not a fragment: Chrome can
// hand a second import of a module the first one's fragment.
const urls = new URL(import.meta.url).searchParams
const name = [...urls.keys()].at(-1).slice(1)
export default (await import(/* @vite-ignore */ urls.get(name))).default
