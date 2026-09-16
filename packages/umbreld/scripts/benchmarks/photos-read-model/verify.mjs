import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {createRequire} from 'node:module'
import {spawnSync} from 'node:child_process'
import os from 'node:os'
// Requires the synthetic fixtures/results from the photos-schema-benchmark
// branch. Production databases are never opened; writes use local copies.
const source = new URL('../../../', import.meta.url).pathname
const harness = process.env.PHOTOS_SCHEMA_HARNESS
if (!harness) throw new Error('Set PHOTOS_SCHEMA_HARNESS to the experiment scripts directory')
const lab = process.env.PHOTOS_BENCH_DIR
if (!lab) throw new Error('Set PHOTOS_BENCH_DIR to the completed synthetic experiment')
const output = process.env.PRODUCTION_PHOTOS_BENCH_DIR
if (!output) throw new Error('Set PRODUCTION_PHOTOS_BENCH_DIR to a new output directory')
if (path.resolve(output) === path.resolve(lab)) throw new Error('Output must differ from the baseline directory')
const require = createRequire(path.join(source, 'package.json'))
const Database = require('better-sqlite3')
const {default: Repository} = await import(path.join(source, 'source/modules/photos/repository.ts'))
const {default: Enrichment} = await import(path.join(source, 'source/modules/files/file-index-enrichment.ts'))
const {migratePhotos} = await import(path.join(source, 'source/modules/photos/migrations.ts'))
const {migrateFileIndex} = await import(path.join(source, 'source/modules/files/file-index/migrations.ts'))
const {photoLibraryCte} = await import(path.join(source, 'source/modules/photos/library-sql.ts'))
const {open, copyFixture, checkpoint, hash} = await import(path.join(harness, 'fixture.mjs'))
const {makeCases} = await import(path.join(harness, 'cases.mjs'))
const {instrument} = await import(path.join(harness, 'reads.mjs'))
const {writeCases} = await import(path.join(harness, 'writes.mjs'))
const stable = (value) =>
	value === undefined
		? {$undefined: true}
		: Buffer.isBuffer(value)
			? {$buffer: value.toString('hex')}
			: Array.isArray(value)
				? value.map(stable)
				: value && typeof value === 'object'
					? Object.fromEntries(
							Object.keys(value)
								.sort()
								.map((k) => [k, stable(value[k])]),
						)
					: value
const digest = (value) =>
	createHash('sha256')
		.update(JSON.stringify(stable(value)))
		.digest('hex')
const save = (file, value) => fs.writeFileSync(path.join(output, file), JSON.stringify(value, null, 2))
fs.mkdirSync(output, {recursive: true})
async function build(profile) {
	const folder = path.join(output, profile)
	assert(!fs.existsSync(folder), 'Use a fresh output directory')
	copyFixture(path.join(lab, profile), folder)
	const durable = new Database(path.join(folder, 'umbrel.db'))
	migratePhotos(durable)
	durable.close()
	const db = open(folder)
	await migrateFileIndex(db)
	const start = performance.now()
	new Repository().syncAll(db)
	const buildMs = performance.now() - start
	const settings = {
		sqliteVersion: db.prepare('SELECT sqlite_version() AS version').get().version,
		main: Object.fromEntries(
			['page_size', 'journal_mode', 'synchronous', 'cache_size', 'temp_store', 'mmap_size', 'automatic_index'].map(
				(name) => [name, db.pragma(name, {simple: true})],
			),
		),
		umbrel: Object.fromEntries(
			['page_size', 'journal_mode', 'synchronous', 'cache_size'].map((name) => [
				name,
				db.pragma('umbrel.' + name, {simple: true}),
			]),
		),
	}
	checkpoint(db)
	db.close()
	save(profile + '-build.json', {
		buildMs,
		settings,
		bytes: ['index.db', 'umbrel.db'].map((f) => [f, fs.statSync(path.join(folder, f)).size]),
	})
	console.log(JSON.stringify({profile, buildMs}))
}
async function reads(profile) {
	const catalog = open(path.join(lab, profile), true),
		cases = makeCases(catalog).filter((test) => !process.argv[4] || test.name === process.argv[4])
	catalog.close()
	for (const test of cases) {
		const raw = open(path.join(output, profile), true),
			timer = instrument(raw),
			repo = new Repository()
		const enrichment = new Enrichment(
			{
				dataDirectory: path.join(lab, 'artifacts'),
				logger: {log() {}, verbose() {}, error() {}},
				withDatabase: async (op) => op(timer.db),
				photosAvailable: () => true,
				onStalePath: async () => {
					throw Error('stale')
				},
			},
			{
				remove: async () => {
					throw Error('delete')
				},
			},
		)
		const run = () =>
			timer.measure(() =>
				test.type === 'repository'
					? repo[test.method](timer.db, ...test.args)
					: test.type === 'sql'
						? timer.db.prepare(test.sql).get(...test.args)
						: enrichment[test.method](...test.args),
			)
		try {
			const baseline = JSON.parse(
				fs.readFileSync(path.join(lab, profile + '-read-cases', test.name + '--pr.json'), 'utf8'),
			)
			const first = await run(),
				resultHash = digest(first.result)
			assert.equal(resultHash, baseline.resultHash, profile + ':' + test.name)
			const runs = []
			for (let i = 0; i < 3; i++) {
				const measured = await run()
				assert.equal(digest(measured.result), resultHash)
				runs.push(measured.stats)
			}
			save(profile + '--' + test.name + '.json', {
				profile,
				name: test.name,
				resultHash,
				first: first.stats,
				runs,
				plans: timer.plans(),
			})
			console.log(JSON.stringify({profile, name: test.name, ms: runs.map((r) => r.sqlMs).sort((a, b) => a - b)[1]}))
		} finally {
			raw.close()
		}
	}
}
function validate(db) {
	for (const account of ['0', 'member']) {
		for (const [table, cte, order] of [
			['items', 'logical_items', 'content_hash,root_kind'],
			['locations', 'authorized_locations', 'content_hash,root_kind,entry_id,source_id'],
			['pairs', 'derived_live_pairs', 'still_hash'],
			['active_pairs', 'active_live_pairs', 'still_hash,root_kind'],
		]) {
			const cols = db
				.prepare('PRAGMA table_info(photos_library_' + table + ')')
				.all()
				.map((c) => c.name)
				.join(',')
			const expected = db.prepare(`${photoLibraryCte()} SELECT ${cols} FROM ${cte} ORDER BY ${order}`).all(account)
			assert.deepEqual(
				db.prepare(`SELECT ${cols} FROM photos_library_${table} WHERE account_id=? ORDER BY ${order}`).all(account),
				expected,
				table + ':' + account,
			)
		}
		assert.deepEqual(
			db
				.prepare(
					'SELECT content_hash,effective_taken_at FROM umbrel.photos_content_state WHERE account_id=? AND effective_taken_at IS NOT NULL ORDER BY content_hash',
				)
				.all(account),
			db
				.prepare(
					`${photoLibraryCte()} SELECT content_hash,logical_taken_at AS effective_taken_at FROM logical_items WHERE root_kind='home' ORDER BY content_hash`,
				)
				.all(account),
		)
	}
}
async function writes() {
	const observations = []
	for (let repeat = 0; repeat < 4; repeat++) {
		const folder = path.join(output, 'write-' + repeat)
		copyFixture(path.join(output, 'mixed'), folder)
		const db = open(folder),
			repo = new Repository()
		try {
			for (const test of writeCases()) {
				checkpoint(db)
				const start = performance.now()
				const phases = {}
				db.transaction(() => {
					let at = performance.now()
					if (test.favorite !== undefined)
						repo.setFavorite(db, '0', [hash(4001).toString('hex')], Boolean(test.favorite))
					else test.mutate(db)
					phases.mutationMs = performance.now() - at
					at = performance.now()
					if (test.name === 'rebuild-all-accounts') db.prepare('UPDATE photos_read_model_state SET initialized=0').run()
					// Use production journal maintenance, including recovery from a missed callback.
					// No user-facing read is included in the write timing.
					repo.syncPendingChanges(db)
					phases.maintenanceMs = performance.now() - at
				}).immediate()
				const totalMs = performance.now() - start
				const walBytes = ['index.db-wal', 'umbrel.db-wal'].reduce(
					(n, f) => n + (fs.existsSync(path.join(folder, f)) ? fs.statSync(path.join(folder, f)).size : 0),
					0,
				)
				observations.push({repeat, name: test.name, totalMs, walBytes, ...phases})
				save('writes.json', observations)
				console.log(JSON.stringify({repeat, name: test.name, totalMs}))
				if (repeat === 0) validate(db)
			}
		} finally {
			checkpoint(db)
			db.close()
		}
	}
}
const mode = process.argv[2]
if (mode === 'build') {
	const files = [
		'source/modules/photos/repository.ts',
		'source/modules/photos/read-model.ts',
		'source/modules/photos/library-sql.ts',
		'source/modules/photos/read-model-schema.ts',
	]
	save('implementation.json', {
		node: process.version,
		platform: process.platform,
		arch: process.arch,
		cpu: os.cpus()[0]?.model,
		memoryBytes: os.totalmem(),
		versions: process.versions,
		files: Object.fromEntries(
			files.map((file) => [
				file,
				createHash('sha256')
					.update(fs.readFileSync(path.join(source, file)))
					.digest('hex'),
			]),
		),
	})
	for (const profile of ['device', 'mixed']) await build(profile)
} else if (mode === 'read-case') await reads(process.argv[3])
else if (mode === 'reads') {
	for (const profile of ['device', 'mixed']) {
		const db = open(path.join(lab, profile), true),
			cases = makeCases(db)
		db.close()
		for (const test of cases) {
			const child = spawnSync(
				process.execPath,
				['--import', 'tsx', new URL(import.meta.url).pathname, 'read-case', profile, test.name],
				{stdio: 'inherit', timeout: 75000},
			)
			if (child.error) throw child.error
			if (child.status !== 0) throw new Error(`${profile}/${test.name} failed: ${child.status ?? child.signal}`)
		}
	}
} else if (mode === 'writes') await writes()
else throw Error('expected build, reads or writes')
