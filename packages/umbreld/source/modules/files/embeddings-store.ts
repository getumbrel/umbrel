import nodePath from 'node:path'

import BetterSqlite3 from 'better-sqlite3'
import fse from 'fs-extra'

import {soundsIn} from './sounds.ts'
import {pairs} from './unspaced.ts'

// What the model made of every picture it has read (see embeddings.ts), in a
// database of its own, kept by the hash of the content that was read. The
// file index is replaced whenever its schema changes and content ids start
// again from one, but a library's embeddings are hours of work on the GPU: a
// photo whose embedding is already here is not read again.
//
// A photo has one embedding. A video has one for each frame of it that was
// read, in order, with where in the video the frame is.
//
// The faces found in a picture are here too: where each is, how sure the
// detector was, and the embedding that tells one person's face from
// another's, kept as the model returns it.
//
// So are the words in things: a document's text a passage at a time, each
// with its embedding; the lines read off a picture, each with where it is;
// and what is said in a video or recording, a stretch at a time, with when.
// All of it can be searched for by word, what is in a script written without
// spaces by any run of its characters (see unspaced.ts), and speech that was
// written down in other letters than it was said in by how its words sound
// (see sounds.ts).
//
// What a model has read is noted whether or not it found anything in it.
//
// A change of model, or of how it is asked, makes everything here useless.
// Raising the version empties it, and every picture is read again.
const VERSION = 1

export function embeddingsDatabasePath(dataDirectory: string) {
	return nodePath.join(dataDirectory, 'embeddings', 'embeddings.db')
}

// A face as the models found it: where it is, as fractions of the picture
// from its top left, and for a video's, where in the video the frame is
export type StoredFace = {
	box: {x: number; y: number; width: number; height: number}
	score: number
	atMs?: number
	embedding: ArrayLike<number>
}

// A stored face embedding, as numbers
export function faceEmbedding(stored: Buffer) {
	// Copied, since a float can't be read from just any place in someone else's memory
	return new Float32Array(Uint8Array.from(stored).buffer)
}

// Words found in a content: where (a document's page, a picture's rectangle
// as fractions from its top left, or a recording's stretch of time), and for
// a document's or a recording's the embedding of what they say
export type StoredPassage = {
	kind: 'document' | 'picture' | 'speech'
	text: string
	page?: number
	box?: {x: number; y: number; width: number; height: number}
	atMs?: number
	endMs?: number
	embedding?: Int8Array
	// What its embedding is to be made from, and the name it is made under,
	// where that is left for later (see nextUnembedded)
	toEmbed?: {title: string; text: string}
	// What was said in another script, written in Latin letters: also found
	// by how its words sound (see sounds.ts)
	romanised?: boolean
}

// Opens the store. Everything in it can be made again, so one that is not a
// database any more is started over. One that can't be opened for any other
// reason (a full disk) is left as it is, and nothing is read until it can be.
export function openEmbeddingsStore(databasePath: string, logger: {error: (message: string, error?: unknown) => void}) {
	for (const startOver of [false, true]) {
		try {
			if (startOver) for (const suffix of ['', '-wal', '-shm']) fse.removeSync(databasePath + suffix)
			return new EmbeddingsStore(databasePath)
		} catch (error) {
			const {code} = error as {code?: string}
			const broken = code === 'SQLITE_CORRUPT' || code === 'SQLITE_NOTADB'
			logger.error(`Failed to open what the models have read${broken && !startOver ? '; starting it over' : ''}`, error)
			if (!broken) return
		}
	}
}

export default class EmbeddingsStore {
	#database: BetterSqlite3.Database
	// Nothing was kept from before: whatever the file index says has been
	// embedded has to be embedded again
	readonly created: boolean

	constructor(databasePath: string) {
		fse.ensureDirSync(nodePath.dirname(databasePath))
		this.#database = new BetterSqlite3(databasePath, {timeout: 5000})
		this.#database.pragma('journal_mode = WAL')
		this.created = this.#database.pragma('user_version', {simple: true}) !== VERSION
		if (this.created) {
			this.#database.exec(`
				DROP TABLE IF EXISTS vectors;
				CREATE TABLE vectors (
					id INTEGER PRIMARY KEY,
					hash BLOB NOT NULL,
					frame INTEGER NOT NULL,
					at_ms INTEGER,
					embedding BLOB NOT NULL
				);
				CREATE UNIQUE INDEX vectors_by_hash ON vectors(hash, frame);
				DROP TABLE IF EXISTS faces;
				CREATE TABLE faces (
					id INTEGER PRIMARY KEY,
					hash BLOB NOT NULL,
					face INTEGER NOT NULL,
					at_ms INTEGER,
					x REAL NOT NULL,
					y REAL NOT NULL,
					width REAL NOT NULL,
					height REAL NOT NULL,
					score REAL NOT NULL,
					embedding BLOB NOT NULL
				);
				CREATE UNIQUE INDEX faces_by_hash ON faces(hash, face);
				DROP TABLE IF EXISTS passages_fts;
				DROP TABLE IF EXISTS passages;
				CREATE TABLE passages (
					id INTEGER PRIMARY KEY,
					hash BLOB NOT NULL,
					kind TEXT NOT NULL CHECK (kind IN ('document', 'picture', 'speech')),
					seq INTEGER NOT NULL,
					at_ms INTEGER,
					end_ms INTEGER,
					page INTEGER,
					x REAL,
					y REAL,
					width REAL,
					height REAL,
					text TEXT NOT NULL,
					embedding BLOB
				);
				CREATE UNIQUE INDEX passages_by_hash ON passages(hash, kind, seq);
				CREATE VIRTUAL TABLE passages_fts USING fts5(
					text, content='passages', content_rowid='id', tokenize='unicode61 remove_diacritics 2'
				);
				CREATE TRIGGER passages_fts_insert AFTER INSERT ON passages BEGIN
					INSERT INTO passages_fts(rowid, text) VALUES (new.id, new.text);
				END;
				CREATE TRIGGER passages_fts_delete AFTER DELETE ON passages BEGIN
					INSERT INTO passages_fts(passages_fts, rowid, text) VALUES ('delete', old.id, old.text);
				END;
				DROP TABLE IF EXISTS passages_pairs;
				CREATE VIRTUAL TABLE passages_pairs USING fts5(pairs, tokenize='ascii');
				CREATE TRIGGER passages_pairs_delete AFTER DELETE ON passages BEGIN
					DELETE FROM passages_pairs WHERE rowid = old.id;
				END;
				DROP TABLE IF EXISTS passages_sounds;
				CREATE VIRTUAL TABLE passages_sounds USING fts5(sounds, tokenize='ascii');
				CREATE TRIGGER passages_sounds_delete AFTER DELETE ON passages BEGIN
					DELETE FROM passages_sounds WHERE rowid = old.id;
				END;
				DROP TABLE IF EXISTS read;
				CREATE TABLE read (hash BLOB NOT NULL, work TEXT NOT NULL, PRIMARY KEY (hash, work)) WITHOUT ROWID;
				PRAGMA user_version = ${VERSION};
			`)
		}
		// Passages kept without their embedding, which is made later: what of
		// each it is made from. Added once stores were in use, so made here,
		// where it leaves what one already has alone.
		this.#database.exec(`
			CREATE TABLE IF NOT EXISTS unembedded (passage INTEGER PRIMARY KEY, title TEXT NOT NULL, text TEXT NOT NULL);
			CREATE TRIGGER IF NOT EXISTS unembedded_delete AFTER DELETE ON passages BEGIN
				DELETE FROM unembedded WHERE passage = old.id;
			END;
		`)
	}

	// How many of a content's embeddings are here
	count(hash: Buffer) {
		return this.#database.prepare('SELECT COUNT(*) FROM vectors WHERE hash = ?').pluck().get(hash) as number
	}

	has(hash: Buffer, frame = 0) {
		return this.#database.prepare('SELECT 1 FROM vectors WHERE hash = ? AND frame = ?').get(hash, frame) !== undefined
	}

	set(hash: Buffer, embedding: Int8Array, frame = 0, atMs?: number) {
		this.#database
			.prepare(
				`INSERT INTO vectors(hash, frame, at_ms, embedding) VALUES (?, ?, ?, ?)
				ON CONFLICT(hash, frame) DO UPDATE SET at_ms = excluded.at_ms, embedding = excluded.embedding`,
			)
			.run(hash, frame, atMs ?? null, Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength))
	}

	// Whether a model has read a content, whatever it found there
	wasRead(hash: Buffer, work: 'faces' | 'text' | 'speech') {
		return this.#database.prepare('SELECT 1 FROM read WHERE hash = ? AND work = ?').get(hash, work) !== undefined
	}

	// The faces found in a content, in the order they are given
	setFaces(hash: Buffer, faces: StoredFace[]) {
		const insert = this.#database.prepare(
			`INSERT INTO faces(hash, face, at_ms, x, y, width, height, score, embedding)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		this.#database.transaction(() => {
			this.#database.prepare('DELETE FROM faces WHERE hash = ?').run(hash)
			for (const [index, {atMs, box, score, embedding}] of faces.entries()) {
				const floats = Float32Array.from(embedding)
				insert.run(
					...[hash, index, atMs ?? null, box.x, box.y, box.width, box.height, score],
					Buffer.from(floats.buffer, floats.byteOffset, floats.byteLength),
				)
			}
			this.#database.prepare("INSERT OR IGNORE INTO read(hash, work) VALUES (?, 'faces')").run(hash)
		})()
	}

	// The words in a content: a document's passages, the lines read off a
	// picture, or what is said in a recording, in order
	setPassages(hash: Buffer, kind: StoredPassage['kind'], passages: Array<Omit<StoredPassage, 'kind'>>) {
		const insert = this.#database.prepare(
			`INSERT INTO passages(hash, kind, seq, at_ms, end_ms, page, x, y, width, height, text, embedding)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		const insertPairs = this.#database.prepare('INSERT INTO passages_pairs(rowid, pairs) VALUES (?, ?)')
		const insertSounds = this.#database.prepare('INSERT INTO passages_sounds(rowid, sounds) VALUES (?, ?)')
		const insertUnembedded = this.#database.prepare('INSERT INTO unembedded(passage, title, text) VALUES (?, ?, ?)')
		this.#database.transaction(() => {
			this.#database.prepare('DELETE FROM passages WHERE hash = ? AND kind = ?').run(hash, kind)
			for (const [index, {atMs, endMs, page, box, text, embedding, toEmbed, romanised}] of passages.entries()) {
				const {lastInsertRowid} = insert.run(
					...[hash, kind, index, atMs ?? null, endMs ?? null, page ?? null],
					...[box?.x ?? null, box?.y ?? null, box?.width ?? null, box?.height ?? null, text],
					embedding ? Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength) : null,
				)
				if (toEmbed && !embedding) insertUnembedded.run(lastInsertRowid, toEmbed.title, toEmbed.text)
				const unspaced = pairs(text)
				if (unspaced) insertPairs.run(lastInsertRowid, unspaced)
				if (romanised) {
					insertSounds.run(
						lastInsertRowid,
						soundsIn(text)
							.map(({sound}) => sound)
							.join(' '),
					)
				}
			}
			this.#database
				.prepare('INSERT OR IGNORE INTO read(hash, work) VALUES (?, ?)')
				.run(hash, kind === 'speech' ? 'speech' : 'text')
		})()
	}

	// The next passage that was kept without its embedding, if there is one
	nextUnembedded() {
		return this.#database
			.prepare('SELECT passage AS id, title, text FROM unembedded ORDER BY passage LIMIT 1')
			.get() as {id: number; title: string; text: string} | undefined
	}

	// A passage's embedding, made after it was kept. Without one, it is no
	// longer waiting for it: it is found by its words alone.
	setPassageEmbedding(id: number, embedding?: Int8Array) {
		this.#database.transaction(() => {
			if (embedding) {
				this.#database
					.prepare('UPDATE passages SET embedding = ? WHERE id = ?')
					.run(Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength), id)
			}
			this.#database.prepare('DELETE FROM unembedded WHERE passage = ?').run(id)
		})()
	}

	// The embeddings of a content's faces, in order
	faceEmbeddings(hash: Buffer) {
		const rows = this.#database
			.prepare('SELECT embedding FROM faces WHERE hash = ? ORDER BY face')
			.pluck()
			.all(hash) as Buffer[]
		return rows.map(faceEmbedding)
	}

	// A video's embeddings, when what they were made from may not be the video
	deleteVectors(hash: Buffer) {
		this.#database.prepare('DELETE FROM vectors WHERE hash = ?').run(hash)
	}

	delete(hash: Buffer) {
		this.#database.transaction(() => {
			for (const table of ['vectors', 'faces', 'passages', 'read']) {
				this.#database.prepare(`DELETE FROM ${table} WHERE hash = ?`).run(hash)
			}
		})()
	}

	close() {
		this.#database.close()
	}
}
