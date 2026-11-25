import {randomUUID} from 'node:crypto'

import type {Database} from 'better-sqlite3'

import {faceEmbedding} from '../files/embeddings-store.ts'

import type {PhotoPerson, PhotoPersonFace, PhotoPersonSuggestion} from './types.ts'

// People are the faces of a library gathered by who they are. The faces
// themselves, where each is and the embedding that tells one person's from
// another's, are in the embeddings database beside what the models made of
// everything else (see ../files/embeddings-store.ts). Who each face belongs
// to, and every person's name, cover and the user's corrections, are an
// account's own and kept with its albums in umbrel.db.
//
// A face is given to someone once, when it is first seen, and never moved by
// recognition afterwards: whoever a person is stays put under the user. It
// joins the person whose faces it resembles most, when it resembles them
// enough, and otherwise becomes someone new. That is strict on purpose. Being
// strict splits one person in two now and then, which a merge repairs and
// `suggestions` offers; mixing two people into one cannot be repaired without
// going through every picture.
//
// The similarities are cosines between buffalo_l (ArcFace) embeddings, where
// pictures of one person mostly score 0.4 to 0.8 and of two people rarely
// above 0.25. They were set by matching, on the same pairs of faces, the
// rates at which an earlier model's thresholds joined and kept apart people.
//
// A face joins a person whose average face it resembles this much:
const SAME_PERSON = 0.38
// and one who has only been seen a few times this much. With little to go on
// an average is one or two faces, and whoever joins it shapes who it becomes.
const SAME_NEW_PERSON = 0.46
// A person is someone seen at least this often, in more than one picture.
// Everyone seen less is a stranger in the background, kept but not shown.
const MIN_FACES = 3
const MIN_ITEMS = 2
// What the detector is this unsure of, or finds this small, is too often not
// a face or too little of one to tell whose: it belongs to nobody
const MIN_FACE_SCORE = 0.6
const MIN_FACE_SIDE = 0.02
// How many of a suggested person's faces are shown to judge by
const SUGGESTION_FACES = 4
// and how many of their faces, the clearest, vote on who they are. More adds
// nothing but time.
const SUGGESTION_VOTERS = 48
// Two who are in more than this share of the smaller one's pictures together
// are two people. On a library of 42,000 photos the four largest groups that
// were the named person seen again (1,671 to 562 pictures, 43 to 48 of 48
// votes each) shared 1.5% to 3.5% of their pictures with them, and none was
// offered while any shared picture ruled it out.
const MAX_TOGETHER_SHARE = 0.05

// What the user can change about their people. Items are given by id.
export type PeopleChange =
	| {type: 'rename'; id: string; name: string}
	| {type: 'setHidden'; id: string; hidden: boolean}
	| {type: 'setCover'; id: string; itemId?: string}
	| {type: 'merge'; into: string; ids: string[]}
	| {type: 'removeItems'; id: string; itemIds: string[]}
	| {type: 'dismissSuggestion'; id: string; candidateId: string}

// Faces are only found where the models are installed. Elsewhere there is
// nowhere to look for them, and nobody to list.
export function facesAvailable(database: Database) {
	return (
		database.prepare("SELECT 1 FROM pragma_database_list WHERE name = 'embeddings'").get() !== undefined &&
		database.prepare("SELECT 1 FROM embeddings.sqlite_master WHERE name = 'faces'").get() !== undefined
	)
}

type Average = {sum: Float32Array; faces: number}

function similarity(face: Float32Array, {sum}: Average) {
	let dot = 0
	let length = 0
	for (let index = 0; index < sum.length; index++) {
		dot += face[index] * sum[index]
		length += sum[index] * sum[index]
	}
	return dot / Math.sqrt(length) || 0
}

function add(average: Average, face: Float32Array) {
	for (let index = 0; index < face.length; index++) average.sum[index] += face[index]
	average.faces++
}

// Every person of an account with the average of their faces
function averages(database: Database, accountId: string) {
	const people = new Map<string, Average>()
	const faces = database
		.prepare(
			`SELECT assigned.person_id AS personId, face.embedding FROM umbrel.photos_faces AS assigned
			JOIN embeddings.faces AS face ON face.hash = assigned.content_hash AND face.face = assigned.face
			WHERE assigned.account_id = ? AND assigned.person_id IS NOT NULL`,
		)
		.iterate(accountId) as Iterable<{personId: string; embedding: Buffer}>
	for (const {personId, embedding} of faces) {
		const face = faceEmbedding(embedding)
		const average = people.get(personId)
		if (average) add(average, face)
		else people.set(personId, {sum: face, faces: 1})
	}
	return people
}

// Gives the faces of contents to people, for every account that has the
// content in its library and has not placed its faces yet. The writer keeps
// one of these: it holds each account's people as averages between calls.
export class PeopleAssigner {
	#accounts = new Map<string, Map<string, Average>>()

	// After a merge or a correction the averages are no longer whose they were
	forget(accountId: string) {
		this.#accounts.delete(accountId)
	}

	forgetAll() {
		this.#accounts.clear()
	}

	// Resolves to the accounts whose people changed
	assign(database: Database, hashes: Buffer[]) {
		const accounts = database.prepare("SELECT DISTINCT owner_id FROM index_roots WHERE kind = 'home'").pluck().all()
		const changed = new Set<string>()
		for (const hash of hashes) {
			for (const accountId of accounts as string[]) {
				if (this.#assignContent(database, accountId, hash)) changed.add(accountId)
			}
		}
		return [...changed]
	}

	// Contents with faces that an account has in its library and has not
	// placed: the ones missed when a model finished while nobody was told, or
	// that arrived in a second account after the first
	unassigned(database: Database, limit: number) {
		return database
			.prepare(
				`SELECT DISTINCT item.content_hash FROM photos_library_items AS item
				WHERE item.root_kind = 'home'
					AND EXISTS (SELECT 1 FROM embeddings.faces AS face WHERE face.hash = item.content_hash)
					AND NOT EXISTS (SELECT 1 FROM umbrel.photos_faces AS assigned
						WHERE assigned.account_id = item.account_id AND assigned.content_hash = item.content_hash)
				LIMIT ?`,
			)
			.pluck()
			.all(limit) as Buffer[]
	}

	#assignContent(database: Database, accountId: string, hash: Buffer) {
		const inLibrary = database
			.prepare("SELECT 1 FROM photos_library_items WHERE account_id = ? AND content_hash = ? AND root_kind = 'home'")
			.get(accountId, hash)
		const placed = database
			.prepare('SELECT 1 FROM umbrel.photos_faces WHERE account_id = ? AND content_hash = ? LIMIT 1')
			.get(accountId, hash)
		if (!inLibrary || placed) return false
		const faces = database
			.prepare(
				'SELECT face, at_ms AS atMs, width, height, score, embedding FROM embeddings.faces WHERE hash = ? ORDER BY face',
			)
			.all(hash) as Array<{
			face: number
			atMs: number | null
			width: number
			height: number
			score: number
			embedding: Buffer
		}>
		if (faces.length === 0) return false
		let people = this.#accounts.get(accountId)
		if (!people) this.#accounts.set(accountId, (people = averages(database, accountId)))
		const place = database.prepare(
			'INSERT INTO umbrel.photos_faces(account_id, content_hash, face, person_id) VALUES (?, ?, ?, ?)',
		)
		// Nobody is in one picture twice: the faces of one photo, or of one frame
		// of a video, are different people
		const taken = new Map<number | null, Set<string>>()
		for (const {face, atMs, width, height, score, embedding} of faces) {
			if (score < MIN_FACE_SCORE || Math.min(width, height) < MIN_FACE_SIDE) {
				place.run(accountId, hash, face, null)
				continue
			}
			const here = taken.get(atMs) ?? new Set()
			taken.set(atMs, here)
			const vector = faceEmbedding(embedding)
			let personId: string | undefined
			let best = 0
			for (const [candidateId, average] of people) {
				if (here.has(candidateId)) continue
				const likeness = similarity(vector, average)
				if (likeness > best && likeness >= (average.faces < MIN_FACES ? SAME_NEW_PERSON : SAME_PERSON)) {
					best = likeness
					personId = candidateId
				}
			}
			if (personId) {
				add(people.get(personId)!, vector)
			} else {
				personId = randomUUID()
				database
					.prepare('INSERT INTO umbrel.photos_people(id, account_id, created_at) VALUES (?, ?, ?)')
					.run(personId, accountId, Date.now())
				people.set(personId, {sum: vector, faces: 1})
			}
			here.add(personId)
			place.run(accountId, hash, face, personId)
		}
		return true
	}
}

type PersonRow = {
	id: string
	name: string | null
	is_hidden: number
	cover_content_hash: Buffer | null
	count: number
	taken_from: number | null
	taken_to: number | null
}

// The faces of a person that can stand for them, clearest first: a face in a
// photo, since a video's is in a frame that no still of the video shows
function clearestFaces(database: Database, accountId: string, personId: string, limit: number, hash?: Buffer | null) {
	const rows = database
		.prepare(
			`SELECT lower(hex(item.content_hash)) AS itemId, face.x, face.y, face.width AS faceWidth, face.height AS faceHeight,
				item.width, item.height, item.tint
			FROM umbrel.photos_faces AS assigned
			JOIN embeddings.faces AS face ON face.hash = assigned.content_hash AND face.face = assigned.face
			JOIN photos_library_items AS item ON item.account_id = assigned.account_id
				AND item.content_hash = assigned.content_hash AND item.root_kind = 'home'
			WHERE assigned.account_id = ? AND assigned.person_id = ? AND face.at_ms IS NULL
				AND (? IS NULL OR assigned.content_hash = ?)
			ORDER BY face.score * face.width * face.height DESC LIMIT ?`,
		)
		.all(accountId, personId, hash ?? null, hash ?? null, limit) as Array<{
		itemId: string
		x: number
		y: number
		faceWidth: number
		faceHeight: number
		width: number
		height: number
		tint: number | null
	}>
	return rows.map(
		({itemId, x, y, faceWidth, faceHeight, width, height, tint}): PhotoPersonFace => ({
			itemId,
			face: {x, y, width: faceWidth, height: faceHeight},
			width,
			height,
			...(tint === null ? {} : {tint}),
		}),
	)
}

// An account's people, the ones in the most pictures first. Someone unnamed
// is only listed once they have been seen often enough to be someone.
export function listPeople(database: Database, accountId: string, hidden: boolean): PhotoPerson[] {
	const rows = database
		.prepare(
			`SELECT person.id, person.name, person.is_hidden, person.cover_content_hash,
				COUNT(DISTINCT item.content_hash) AS count, MIN(item.logical_taken_at) AS taken_from,
				MAX(item.logical_taken_at) AS taken_to
			FROM umbrel.photos_people AS person
			JOIN umbrel.photos_faces AS assigned ON assigned.person_id = person.id
			JOIN photos_library_items AS item ON item.account_id = person.account_id
				AND item.content_hash = assigned.content_hash AND item.root_kind = 'home'
			WHERE person.account_id = ? AND person.is_hidden = ?
			GROUP BY person.id
			HAVING person.name IS NOT NULL OR (COUNT(*) >= ${MIN_FACES} AND count >= ${MIN_ITEMS})
			ORDER BY person.name IS NULL, count DESC, person.created_at, person.id`,
		)
		.all(accountId, Number(hidden)) as PersonRow[]
	const people: PhotoPerson[] = []
	for (const row of rows) {
		const cover =
			(row.cover_content_hash && clearestFaces(database, accountId, row.id, 1, row.cover_content_hash)[0]) ||
			clearestFaces(database, accountId, row.id, 1)[0]
		// Someone only ever seen in videos has no face to show yet
		if (!cover) continue
		people.push({
			id: row.id,
			...(row.name === null ? {} : {name: row.name}),
			count: row.count,
			cover,
			isHidden: row.is_hidden === 1,
			...(row.taken_from === null ? {} : {takenFrom: row.taken_from}),
			...(row.taken_to === null ? {} : {takenTo: row.taken_to}),
		})
	}
	return people
}

// Who is in an item, with where the first of each one's faces is
export function peopleOfItem(database: Database, accountId: string, hash: Buffer) {
	const rows = database
		.prepare(
			`SELECT person.id, person.name, face.x, face.y, face.width, face.height
			FROM umbrel.photos_faces AS assigned
			JOIN umbrel.photos_people AS person ON person.id = assigned.person_id
			JOIN embeddings.faces AS face ON face.hash = assigned.content_hash AND face.face = assigned.face
			WHERE assigned.account_id = ? AND assigned.content_hash = ? AND person.is_hidden = 0
			GROUP BY person.id ORDER BY MIN(assigned.face)`,
		)
		.all(accountId, hash) as Array<{
		id: string
		name: string | null
		x: number
		y: number
		width: number
		height: number
	}>
	return rows.map(({id, name, ...face}) => ({id, ...(name === null ? {} : {name}), face}))
}

// "Is this also Anna?": someone unnamed who looks like someone named seen
// again. Each of the unnamed person's faces votes for the named person whose
// average face it would have joined, had it been compared with theirs. It is
// suggested when one named person takes at least half of the votes and twice
// as many as anyone else, with enough of them, in enough pictures, to be
// someone (the rule an earlier version of search settled on). Never when the
// user has already said no, or when the two are in a picture together more
// than now and then: someone is beside themselves in a mirror, and in a photo
// of a photo. The surest first.
export function suggestions(database: Database, accountId: string): PhotoPersonSuggestion[] {
	const listed = listPeople(database, accountId, false)
	const named = listed.filter((person) => person.name !== undefined)
	const unnamed = listed.filter((person) => person.name === undefined)
	if (named.length === 0 || unnamed.length === 0) return []
	const people = averages(database, accountId)
	const ruledOut = new Set(
		database
			.prepare(
				`SELECT person_id || ' ' || candidate_id FROM umbrel.photos_people_dismissed
				JOIN umbrel.photos_people ON umbrel.photos_people.id = person_id WHERE account_id = ?`,
			)
			.pluck()
			.all(accountId) as string[],
	)
	// How many pictures each named person is in with each other person: in
	// the same photo, or the same frame of a video
	const together = new Map(
		(
			database
				.prepare(
					`SELECT first.person_id || ' ' || second.person_id AS pair, COUNT(DISTINCT first.content_hash) AS items
					FROM umbrel.photos_people AS person
					JOIN umbrel.photos_faces AS first ON first.person_id = person.id
					JOIN umbrel.photos_faces AS second ON second.account_id = first.account_id
						AND second.content_hash = first.content_hash AND second.person_id != first.person_id
					JOIN embeddings.faces AS first_face ON first_face.hash = first.content_hash AND first_face.face = first.face
					JOIN embeddings.faces AS second_face ON second_face.hash = second.content_hash AND second_face.face = second.face
					WHERE person.account_id = ? AND person.name IS NOT NULL AND first_face.at_ms IS second_face.at_ms
					GROUP BY first.person_id, second.person_id`,
				)
				.all(accountId) as Array<{pair: string; items: number}>
		).map(({pair, items}) => [pair, items]),
	)
	const counts = new Map(listed.map(({id, count}) => [id, count]))
	const facesOf = database.prepare(
		`SELECT assigned.content_hash AS hash, face.embedding FROM umbrel.photos_faces AS assigned
		JOIN embeddings.faces AS face ON face.hash = assigned.content_hash AND face.face = assigned.face
		WHERE assigned.account_id = ? AND assigned.person_id = ?
		ORDER BY face.score * face.width * face.height DESC LIMIT ${SUGGESTION_VOTERS}`,
	)
	const found: Array<PhotoPersonSuggestion & {share: number}> = []
	for (const candidate of unnamed) {
		const votes = new Map<string, {faces: number; items: Set<string>}>()
		const faces = facesOf.all(accountId, candidate.id) as Array<{hash: Buffer; embedding: Buffer}>
		for (const {hash, embedding} of faces) {
			const face = faceEmbedding(embedding)
			let best: {id: string; likeness: number} | undefined
			for (const person of named) {
				const average = people.get(person.id)
				if (!average) continue
				const likeness = similarity(face, average)
				if (likeness >= SAME_PERSON && likeness > (best?.likeness ?? 0)) best = {id: person.id, likeness}
			}
			if (!best) continue
			const vote = votes.get(best.id) ?? {faces: 0, items: new Set()}
			votes.set(best.id, vote)
			vote.faces++
			vote.items.add(hash.toString('hex'))
		}
		const [first, second] = [...votes].sort(([, a], [, b]) => b.faces - a.faces)
		if (!first) continue
		const [personId, vote] = first
		if (
			vote.faces < MIN_FACES ||
			vote.items.size < MIN_ITEMS ||
			vote.faces * 2 < faces.length ||
			vote.faces < (second?.[1].faces ?? 0) * 2 ||
			ruledOut.has(`${personId} ${candidate.id}`) ||
			ruledOut.has(`${candidate.id} ${personId}`) ||
			(together.get(`${personId} ${candidate.id}`) ?? 0) >
				MAX_TOGETHER_SHARE * Math.min(candidate.count, counts.get(personId) ?? 0)
		) {
			continue
		}
		found.push({
			person: {id: personId, name: named.find((person) => person.id === personId)!.name!},
			candidate: {...candidate, faces: clearestFaces(database, accountId, candidate.id, SUGGESTION_FACES)},
			share: vote.faces / faces.length,
		})
	}
	return found.sort((first, second) => second.share - first.share).map(({share, ...suggestion}) => suggestion)
}

// The user's changes. Each resolves to whether there was anything to change.

export function renamePerson(database: Database, accountId: string, id: string, name: string) {
	return (
		database
			.prepare('UPDATE umbrel.photos_people SET name = ? WHERE id = ? AND account_id = ?')
			.run(name || null, id, accountId).changes > 0
	)
}

export function setPersonHidden(database: Database, accountId: string, id: string, hidden: boolean) {
	return (
		database
			.prepare('UPDATE umbrel.photos_people SET is_hidden = ? WHERE id = ? AND account_id = ?')
			.run(Number(hidden), id, accountId).changes > 0
	)
}

// Without a content, the cover goes back to the clearest face
export function setPersonCover(database: Database, accountId: string, id: string, hash?: Buffer) {
	return (
		database
			.prepare('UPDATE umbrel.photos_people SET cover_content_hash = ? WHERE id = ? AND account_id = ?')
			.run(hash ?? null, id, accountId).changes > 0
	)
}

// Folds `ids` into `into`: one person afterwards, who keeps `into`'s name
export function mergePeople(database: Database, accountId: string, into: string, ids: string[]) {
	const owned = database.prepare('SELECT 1 FROM umbrel.photos_people WHERE id = ? AND account_id = ?')
	const others = ids.filter((id) => id !== into)
	if (!owned.get(into, accountId) || others.some((id) => !owned.get(id, accountId))) return false
	for (const id of others) {
		database.prepare('UPDATE umbrel.photos_faces SET person_id = ? WHERE person_id = ?').run(into, id)
		database.prepare('DELETE FROM umbrel.photos_people WHERE id = ?').run(id)
	}
	return true
}

// "This isn't them": takes the person off these contents for good. Their
// faces there belong to nobody, and stay that way.
export function removePersonContents(database: Database, accountId: string, id: string, hashes: Buffer[]) {
	const remove = database.prepare(
		'UPDATE umbrel.photos_faces SET person_id = NULL WHERE account_id = ? AND person_id = ? AND content_hash = ?',
	)
	let removed = 0
	for (const hash of hashes) removed += remove.run(accountId, id, hash).changes
	return removed
}

// "No, that isn't them": `candidateId` is never suggested as `id` again
export function dismissSuggestion(database: Database, accountId: string, id: string, candidateId: string) {
	const owned = database.prepare('SELECT 1 FROM umbrel.photos_people WHERE id = ? AND account_id = ?')
	if (!owned.get(id, accountId) || !owned.get(candidateId, accountId)) return false
	database
		.prepare('INSERT OR IGNORE INTO umbrel.photos_people_dismissed(person_id, candidate_id) VALUES (?, ?)')
		.run(id, candidateId)
	return true
}
