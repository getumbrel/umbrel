import {readdir, readFile} from 'node:fs/promises'
import nodePath from 'node:path'
import {fileURLToPath} from 'node:url'

import {expect, test, vi} from 'vitest'

import {isRaspberryPiCpuInfo, loadBlake3Hasher, type Blake3HasherConstructor} from './blake3.ts'

class FakeNativeHasher {
	update() {
		return this
	}

	digestBuffer() {
		return Buffer.from('native')
	}
}

test('detects Raspberry Pi hardware from cpuinfo', () => {
	expect(isRaspberryPiCpuInfo('Model\t: Raspberry Pi 4 Model B Rev 1.5')).toBe(true)
	expect(isRaspberryPiCpuInfo('Model\t: Raspberry Pi 5 Model B Rev 1.0')).toBe(true)
	expect(isRaspberryPiCpuInfo('model name\t: AMD Ryzen 7 7840U')).toBe(false)
})

test('all BLAKE3 consumers use the Pi-safe wrapper', async () => {
	const sourceDirectory = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), '../..')
	const allowedDirectImports = new Set(['modules/files/blake3.ts', 'modules/files/blake3.unit.test.ts'])
	const sourceFiles = (await readdir(sourceDirectory, {recursive: true})).filter(
		(relativePath) => relativePath.endsWith('.ts') && !allowedDirectImports.has(relativePath),
	)
	const directImplementationImport =
		/(?:from\s+|import\s*\(|require\s*\()\s*['"](?:@napi-rs\/blake-hash|blake3-wasm-rs)['"]/
	const offenders = (
		await Promise.all(
			sourceFiles.map(async (relativePath) =>
				directImplementationImport.test(await readFile(nodePath.join(sourceDirectory, relativePath), 'utf8'))
					? relativePath
					: undefined,
			),
		)
	).filter((relativePath): relativePath is string => relativePath !== undefined)

	expect(offenders).toEqual([])
})

test('loads the existing native implementation on non-Pi hardware', async () => {
	const loadNative = vi.fn(async () => ({Blake3Hasher: FakeNativeHasher as Blake3HasherConstructor}))
	const loadWasm = vi.fn()
	const Blake3Hasher = await loadBlake3Hasher({
		readCpuInfo: async () => 'model name\t: AMD Ryzen 7 7840U',
		loadNative,
		loadWasm,
	})

	expect(Blake3Hasher).toBe(FakeNativeHasher)
	expect(loadNative).toHaveBeenCalledOnce()
	expect(loadWasm).not.toHaveBeenCalled()
})

test('wraps the WASM implementation on Raspberry Pi without loading the native binding', async () => {
	const update = vi.fn()
	const finalize = vi.fn(() => Uint8Array.from([0xde, 0xad, 0xbe, 0xef]))
	class FakeWasmHasher {
		update = update
		finalize = finalize
	}
	const loadNative = vi.fn()
	const loadWasm = vi.fn(async () => ({Hasher: FakeWasmHasher}))
	const Blake3Hasher = await loadBlake3Hasher({
		readCpuInfo: async () => 'Model\t: Raspberry Pi 4 Model B Rev 1.5',
		loadNative,
		loadWasm,
	})
	const hasher = new Blake3Hasher()

	expect(hasher.update('hello')).toBe(hasher)
	expect(update).toHaveBeenCalledWith(Buffer.from('hello'))
	expect(hasher.digestBuffer()).toEqual(Buffer.from([0xde, 0xad, 0xbe, 0xef]))
	expect(finalize).toHaveBeenCalledOnce()
	expect(loadNative).not.toHaveBeenCalled()
	expect(loadWasm).toHaveBeenCalledOnce()
})

test('the WASM adapter produces the same streaming digest as the native implementation', async () => {
	const [{Blake3Hasher: NativeBlake3Hasher}, {Hasher}] = await Promise.all([
		import('@napi-rs/blake-hash'),
		import('blake3-wasm-rs'),
	])
	const PiBlake3Hasher = await loadBlake3Hasher({
		readCpuInfo: async () => 'Model\t: Raspberry Pi 4 Model B Rev 1.5',
		loadNative: async () => ({Blake3Hasher: NativeBlake3Hasher}),
		loadWasm: async () => ({Hasher}),
	})
	const native = new NativeBlake3Hasher()
	const wasm = new PiBlake3Hasher()

	for (const chunk of [Buffer.from('hello'), Buffer.from(' '), Buffer.from('world')]) {
		native.update(chunk)
		wasm.update(chunk)
	}

	expect(wasm.digestBuffer()).toEqual(native.digestBuffer())
})
