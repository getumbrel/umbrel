import {existsSync, readdirSync, readFileSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import type {Plugin} from 'vite'

// The acknowledgements the UI ships, as one plain-text file beside index.html
// (Settings > Device info links to it): the credits for the data, models and
// fonts written in credits.txt, then the licence of every package the build
// takes code or files from. Those have to travel with the build, and bundling
// and minifying strip them from the code, so they are gathered here from each
// package as it is in node_modules.

const FILE_NAME = 'acknowledgements.txt'
const directory = fileURLToPath(new URL('.', import.meta.url))

// LICENSE, LICENSE.md, LICENSE-MIT, LICENCE.txt, COPYING, NOTICE, and
// pdf.js's standard_fonts/LICENSE_FOXIT
const LICENCE_FILE = /^(licen[cs]e|copying|notice)([._-].*)?$/i
const RULE = '-'.repeat(78)

type Package = {name: string; version: string; licence?: string; source?: string; texts: string[]}

// `extra` names packages whose files reach the build some other way than an
// import, such as a copy into public/
export function acknowledgements({extra = []}: {extra?: string[]} = {}): Plugin {
	return {
		name: 'umbrel:acknowledgements',
		apply: 'build',
		generateBundle() {
			const roots = new Map<string, Set<string>>()
			const add = (root: string, from = root) => {
				if (!roots.has(root)) roots.set(root, new Set())
				// Every directory from a module's own up to its package's, which
				// is where a licence for some of a package's files is kept
				for (let at = from; at.startsWith(root); at = path.dirname(at)) roots.get(root)!.add(at)
			}
			for (const id of this.getModuleIds()) {
				const file = id.split('?')[0]!
				if (file.startsWith('\0')) continue
				const root = packageRoot(file)
				if (root) add(root, path.dirname(file))
			}
			for (const name of extra) add(path.join(directory, '../node_modules', name))

			const packages = [...roots].map(([root, directories]) => read(root, directories))
			packages.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))

			this.emitFile({type: 'asset', fileName: FILE_NAME, source: render(packages)})
		},
	}
}

// The package a file in node_modules belongs to: the directory after the last
// node_modules, with its scope
function packageRoot(file: string) {
	const at = file.lastIndexOf('/node_modules/')
	if (at === -1) return undefined
	const [first, second] = file.slice(at + '/node_modules/'.length).split('/')
	return file.slice(0, at) + '/node_modules/' + (first!.startsWith('@') ? `${first}/${second}` : first)
}

function read(root: string, directories: Set<string>): Package {
	const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
	const licence =
		typeof manifest.license === 'string' ? manifest.license : (manifest.license?.type ?? manifest.licenses?.[0]?.type)
	const texts = [...directories]
		.sort()
		.flatMap((at) =>
			existsSync(at)
				? readdirSync(at, {withFileTypes: true})
						.filter((entry) => entry.isFile() && LICENCE_FILE.test(entry.name))
						.map((entry) => path.join(at, entry.name))
				: [],
		)
		.sort()
		.map((file) => readFileSync(file, 'utf8').replace(/\r\n?/g, '\n').trim())
	// Where its code is: what MPL-2.0 asks a build to say, and where the licence
	// of a package that ships no file of it is
	const repository = typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url
	return {
		name: manifest.name,
		version: manifest.version,
		licence,
		source: sourceUrl(repository ?? manifest.homepage),
		texts,
	}
}

// git+https://github.com/a/b.git, git+ssh://git@github.com:a/b.git,
// git://github.com/a/b, github:a/b or a/b, as https://github.com/a/b
function sourceUrl(address?: string) {
	if (!address) return undefined
	if (/^(github:)?[\w.-]+\/[\w.-]+$/.test(address)) return `https://github.com/${address.replace(/^github:/, '')}`
	return address
		.replace(/^git\+/, '')
		.replace(/^git@/, 'ssh://')
		.replace(/^(git|ssh|http):\/\//, 'https://')
		.replace(/^https:\/\/[^/@]+@/, 'https://')
		.replace(/^(https:\/\/[^/:]+):(?!\d)/, '$1/')
		.replace(/(\.git)?\/?$/, '')
}

function render(packages: Package[]) {
	const credits = readFileSync(path.join(directory, 'credits.txt'), 'utf8').trim()
	const software = packages.map(({name, version, licence, source, texts}) =>
		[
			RULE,
			[`${name} ${version}`, licence && `License: ${licence}`, source && `Source: ${source}`]
				.filter(Boolean)
				.join('\n'),
			...texts,
		].join('\n\n'),
	)
	const licences = ['MIT.txt', 'OFL-1.1.txt', 'Apache-2.0.txt'].map((file) =>
		readFileSync(path.join(directory, 'licenses', file), 'utf8').trim(),
	)
	return [
		credits,
		'',
		'SOFTWARE',
		'The umbrelOS interface includes the following open-source software.',
		...software,
		RULE,
		'',
		'LICENSE TEXTS',
		...licences.flatMap((text) => [RULE, text]),
		'',
	].join('\n\n')
}
