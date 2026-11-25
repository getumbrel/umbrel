// @vm-requires-models
import nodePath from 'node:path'

import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, test} from 'vitest'
import {Client, StreamableHTTPClientTransport} from '@modelcontextprotocol/client'
import fse from 'fs-extra'
import got from 'got'
import pRetry from 'p-retry'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'

describe('Search by what is in things, and People', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let owner: {token: string; cookies: string[]}
	let failed = false
	// The owner's picture of a sign, the still of a moment of their video and
	// the person in their photos, for asking about as someone else
	let signId: string
	let stillPath: string
	let personId: string
	// What an agent the owner has let in is given to say who it is
	let agentToken: string

	// A still as a browser asks for one: by its URL, with the token for reading files
	async function still(path: string) {
		const token = await umbreld.client.user.getHttpApiToken.query()
		return umbreld.browserApi.get(`${path}&token=${token}`, {responseType: 'buffer', throwHttpErrors: false})
	}

	const ownerPassword = 'moneyprintergobrrr'
	const directory = () => `${umbreld.vm.dataDirectory}/home/Photos`
	// On a virtual machine's CPU a model takes a few seconds to load and a few
	// more for each picture it reads
	const whenRead = {retries: 300, factor: 1, minTimeout: 2000, maxTimeout: 2000}
	const memberPassword = 'passwordpassword'

	async function login(credentials: {userId?: string; password: string}) {
		const response = await got.post(`http://localhost:${umbreld.vm.httpPort}/trpc/user.login`, {
			json: credentials,
			responseType: 'json',
			retry: {limit: 0},
		})
		const token = (response.body as {result: {data: string}}).result.data
		return {token, cookies: response.headers['set-cookie'] ?? []}
	}

	// The file names of what a search of Photos finds, in the order it found them
	async function search(query: string, filter: {favorite?: boolean} = {}) {
		const {results} = await umbreld.client.search.query.query({query, scope: 'photos', limit: 20, filter})
		return results.map(({file}) => file.name)
	}

	// What one of MCP's tools answers an agent
	async function agent<T>(tool: string, input: Record<string, unknown> = {}) {
		const client = new Client(
			{name: 'umbreld-search-vm', version: '1.0.0'},
			{versionNegotiation: {mode: {pin: '2026-07-28'}}},
		)
		const endpoint = new URL(`http://127.0.0.1:${umbreld.vm.httpPort}/mcp`)
		await client.connect(
			new StreamableHTTPClientTransport(endpoint, {requestInit: {headers: {authorization: `Bearer ${agentToken}`}}}),
		)
		try {
			const result = await client.callTool({name: tool, arguments: input})
			const text = (result.content as Array<{type: string; text?: string}>).find(({type}) => type === 'text')?.text
			if (result.isError || !text) throw new Error(text ?? `${tool} gave no answer`)
			return JSON.parse(text) as T
		} finally {
			await client.close()
		}
	}

	// ... and what it finds through the search tool
	const askAgent = (query: string, scope?: 'everything' | 'photos') =>
		agent<{
			files: Array<{name: string; path: string; match: string; photoId?: string; moment?: {startMs: number}}>
			totalFiles: number
			filters?: Array<{type: string; label: string}>
			note?: string
		}>('search_files', {query, ...(scope ? {scope} : {})})

	// Writes a file into the owner's home, whatever is in it
	async function write(path: string, content: string | Buffer) {
		const systemPath = `${umbreld.vm.dataDirectory}/home/${path}`
		await umbreld.vm.sshAsRoot(`
			mkdir -p "$(dirname '${systemPath}')"
			echo '${Buffer.from(content).toString('base64')}' | base64 -d > '${systemPath}'
			chown -R 1000:1000 '${umbreld.vm.dataDirectory}/home/${path.split('/')[0]}'
		`)
	}

	// What a search of everything finds, in order: each file's name with why it matched
	async function searchEverything(query: string) {
		const {results} = await umbreld.client.search.query.query({query, scope: 'everything', limit: 20})
		return results
	}
	const found = (results: Awaited<ReturnType<typeof searchEverything>>) =>
		results.map(({file, kind, match}) => `${file.name}: ${kind} by ${match}`)

	beforeAll(async () => {
		// The models are loaded one after another as there is work for each, and
		// stay for a few minutes: together they want more than the default 2 GB
		// ... and the models are fetched from this machine, as a device fetches
		// them from the download server
		umbreld = await createTestVm({device: 'umbrel-home', memory: 8192, models: true})
		await umbreld.vm.powerOn()
		await umbreld.signup()
		owner = await login({password: ownerPassword})
		await umbreld.setBrowserSession(owner.token, owner.cookies)
	})

	afterAll(async () => await umbreld?.cleanup())

	afterEach(({task}) => {
		if (task.result?.state === 'fail') failed = true
	})

	beforeEach(({skip}) => {
		if (failed) skip()
	})

	test('finds a photo by what it shows, whatever it is called', async () => {
		// With nothing for the models to read they have not been fetched, and
		// Search says it is not ready for more than names
		expect(await umbreld.client.search.status.query()).toMatchObject({available: false, reason: 'starting'})

		// Three pictures whose names say nothing about what is in them
		await umbreld.vm.sshAsRoot(`
			mkdir -p '${directory()}' && cd '${directory()}'
			convert -size 1200x900 xc:white -fill red -draw 'rectangle 350,200 850,700' picture-one.png
			convert -size 1200x900 xc:white -fill blue -draw 'circle 600,450 600,150' picture-two.png
			convert -size 1200x900 xc:white -fill green -draw 'polygon 600,150 250,750 950,750' picture-three.png
			chown -R 1000:1000 .
		`)

		// Each is found by describing it, once the models have been fetched and
		// have read it
		await pRetry(async () => {
			expect(await search('a red square')).toEqual(['picture-one.png'])
			expect(await search('a blue circle')).toEqual(['picture-two.png'])
			expect(await search('a green triangle')).toEqual(['picture-three.png'])
		}, whenRead)
		expect(await umbreld.client.search.status.query()).toMatchObject({available: true})

		// The library has finished indexing
		await pRetry(
			async () => expect(await umbreld.client.photos.library.status.query()).toMatchObject({phase: 'ready'}),
			whenRead,
		)
	})

	test('finds a video by what a later part of it shows', async () => {
		// Ten seconds: five of nothing, then five of a star. It is read as three
		// frames, of which only the last has the star in it.
		await umbreld.vm.sshAsRoot(`
			cd /tmp
			convert -size 640x480 xc:white nothing.png
			convert -size 640x480 xc:white -fill gold \
				-draw 'polygon 320,60 379,198 529,198 408,290 453,430 320,345 187,430 232,290 111,198 261,198' star.png
			ffmpeg -nostdin -loglevel error -loop 1 -t 5 -i nothing.png -loop 1 -t 5 -i star.png \
				-filter_complex '[0][1]concat=n=2:v=1:a=0,format=yuv420p' -r 10 '${directory()}/clip.mp4'
			chown 1000:1000 '${directory()}/clip.mp4'
		`)

		await pRetry(async () => expect(await search('a yellow star')).toEqual(['clip.mp4']), whenRead)
		// The pictures are still the only match for what they show
		expect(await search('a red square')).toEqual(['picture-one.png'])

		// It is found where the star is, from five seconds in, with a still of
		// that moment to show
		const {results} = await umbreld.client.search.query.query({query: 'a yellow star', scope: 'photos'})
		expect(results).toMatchObject([{kind: 'video', match: 'visual'}])
		expect(results[0]!.moment!.startMs).toBeGreaterThanOrEqual(5000)
		expect(results[0]!.moment!.thumbnail).toMatch(/^\/api\/search\/moment\//)

		// The still is a JPEG, and only for someone signed in
		stillPath = results[0]!.moment!.thumbnail!.replace(/^\/api\//, '')
		const picture = await still(stillPath)
		expect(picture.statusCode).toBe(200)
		expect(picture.headers['content-type']).toBe('image/jpeg')
		expect(picture.body.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]))
		expect((await umbreld.unauthenticatedApi.get(stillPath, {throwHttpErrors: false})).statusCode).toBe(401)
	})

	test('finds a picture by the words in it', async () => {
		await umbreld.vm.sshAsRoot(`
			cd '${directory()}'
			convert -size 1200x400 xc:white -pointsize 96 -fill black -annotate +60+220 'HOVERCRAFT EELS' sign.png
			chown 1000:1000 sign.png
		`)
		await pRetry(async () => expect(await search('hovercraft')).toEqual(['sign.png']), whenRead)

		// The words are found as words, and the viewer is told where they are.
		// It may be found by how it looks first, if the search model reads it
		// before the text model does.
		const {results} = await pRetry(async () => {
			const found = await umbreld.client.search.query.query({query: 'hovercraft', scope: 'photos'})
			expect(found.results).toMatchObject([{match: 'text', snippet: {text: 'HOVERCRAFT EELS', highlights: [[0, 10]]}}])
			return found
		}, whenRead)
		signId = results[0]!.photo!.id
		const insights = await umbreld.client.search.insights.query({photoId: signId})
		expect(insights.text).toBe('HOVERCRAFT EELS')
		expect(insights.textQuads).toHaveLength(1)

		// What is written on a picture is one text, whatever line each word is on
		await umbreld.vm.sshAsRoot(`
			cd '${directory()}'
			convert -size 1200x700 xc:white -pointsize 96 -fill black -annotate +60+200 'PARKING' -annotate +60+520 'MARMALADE' jar.png
			chown 1000:1000 jar.png
		`)
		await pRetry(async () => expect((await search('parking marmalade'))[0]).toBe('jar.png'), whenRead)
		const [jar] = await pRetry(async () => {
			const {results} = await umbreld.client.search.query.query({query: 'parking marmalade', scope: 'photos'})
			expect(results[0]).toMatchObject({match: 'text', snippet: {text: 'PARKING MARMALADE'}})
			return results
		}, whenRead)
		expect((await umbreld.client.search.insights.query({photoId: jar!.photo!.id})).textQuads).toHaveLength(2)
	})

	test('finds what was taken in a place by its name, in any language', async () => {
		// Two signs that say where they were photographed: by the Grand Palace
		// in Bangkok, and in Schwabing, a part of Munich
		await umbreld.vm.sshAsRoot(`
			cd '${directory()}'
			convert -size 1200x400 xc:white -pointsize 96 -fill black -annotate +60+220 'TUKTUK RANK' thai.jpg
			convert -size 1200x400 xc:white -pointsize 96 -fill black -annotate +60+220 'ZEPPELIN HANGAR' german.jpg
			exiftool -q -overwrite_original -GPSLatitude=13.75 -GPSLatitudeRef=N -GPSLongitude=100.4913 -GPSLongitudeRef=E thai.jpg
			exiftool -q -overwrite_original -GPSLatitude=48.1642 -GPSLatitudeRef=N -GPSLongitude=11.5861 -GPSLongitudeRef=E german.jpg
			chown 1000:1000 thai.jpg german.jpg
		`)
		const ask = (query: string, scope: 'photos' | 'everything' = 'photos', placeIds?: string[]) =>
			umbreld.client.search.query.query({query, scope, limit: 20, placeIds})
		const names = ({results}: Awaited<ReturnType<typeof ask>>) => results.map(({file}) => file.name)

		// By its country, its region and its city, as soon as it is known where it was taken ...
		await pRetry(async () => {
			expect(names(await ask('thailand'))).toEqual(['thai.jpg'])
			expect(names(await ask('germany'))).toEqual(['german.jpg'])
		}, whenRead)
		expect(names(await ask('Bangkok'))).toEqual(['thai.jpg'])
		expect(names(await ask('bavaria'))).toEqual(['german.jpg'])
		// ... a part of a city being the city
		expect(names(await ask('Munich'))).toEqual(['german.jpg'])
		// ... by what other languages call it
		for (const name of ['Thaïlande', 'Таиланд', '泰国', '曼谷']) expect(names(await ask(name))).toEqual(['thai.jpg'])
		for (const name of ['München', 'Monaco di Baviera', 'ミュンヘン'])
			expect(names(await ask(name))).toEqual(['german.jpg'])
		// ... and from everywhere that is searched
		expect(names(await ask('thailand', 'everything'))).toEqual(['thai.jpg'])
		// ... and a run of Japanese with a number written up against it
		await write('Documents/trip-notes.txt', '2024年の旅行の写真をここに置きます。')
		await pRetry(async () => expect(names(await ask('2024年', 'everything'))).toContain('trip-notes.txt'), whenRead)

		// The place is said to have been understood, and is not looked for as a word
		expect((await ask('in Munich')).understood).toEqual({
			chips: [{type: 'place', label: 'Munich', placeId: 'g:2867714', asTyped: 'in "Munich"'}],
			text: '',
		})

		// In Photos, with more typed, the rest is looked for among what was taken there
		await pRetry(async () => expect(names(await ask('zeppelin'))).toEqual(['german.jpg']), whenRead)
		await pRetry(async () => {
			const narrowed = await ask('zeppelin in germany')
			expect(narrowed.understood).toEqual({
				chips: [{type: 'place', label: 'Germany', placeId: 'c:DE', asTyped: 'zeppelin in "germany"'}],
				text: 'zeppelin',
			})
			expect(narrowed.results).toMatchObject([{file: {name: 'german.jpg'}, match: 'text'}])
		}, whenRead)
		// ... with or without a word that leads to the place
		const bare = await ask('tuktuk thailand')
		expect(bare.understood.chips).toMatchObject([{type: 'place', label: 'Thailand', asTyped: 'tuktuk "thailand"'}])
		expect(names(bare)).toEqual(['thai.jpg'])
		// A word may have been read as a place and meant as a word: where
		// nothing taken there fits, what was typed is looked for as it is, as
		// it is when the word is in quotes
		expect((await ask('zeppelin in thailand')).understood).toEqual({chips: [], text: 'zeppelin in thailand'})
		expect((await ask('"thailand"')).understood).toEqual({chips: [], text: 'thailand'})

		// Anywhere else a place among other words is only words: what a file
		// is called or says. A place alone finds what was taken there as well
		// as what has the word, and not in its place.
		await write('Documents/germany itinerary.txt', 'Trains, and where to change.')
		await pRetry(
			async () => expect(names(await ask('germany itinerary', 'everything'))[0]).toBe('germany itinerary.txt'),
			whenRead,
		)
		expect((await ask('germany itinerary', 'everything')).understood.chips).toEqual([])
		const everywhere = await ask('germany', 'everything')
		expect(everywhere.understood.chips).toEqual([
			{type: 'place', label: 'Germany', placeId: 'c:DE', asTyped: '"germany"'},
		])
		// Both are near the top: one for its name, the other for where it was
		// taken and for a name that is nearly the word
		expect(names(everywhere).slice(0, 2).sort()).toEqual(['german.jpg', 'germany itinerary.txt'])
		// ... and nothing that was taken nowhere is found in a view of a place, whatever it shows
		expect(names(await ask('a red square', 'photos', ['c:TH']))).not.toContain('picture-one.png')

		// A search can be narrowed to places by their ids, as a view that names one is
		expect(names(await ask('', 'photos', ['c:TH']))).toEqual(['thai.jpg'])
		expect(names(await ask('', 'photos', ['c:TH', 'c:DE'])).sort()).toEqual(['german.jpg', 'thai.jpg'])
		expect(names(await ask('zeppelin', 'photos', ['c:TH']))).toEqual([])

		// The name of a place nothing was taken in is only a word
		expect((await ask('paris')).understood.chips).toEqual([])

		// Whoever looks at one is told where it was taken
		const [{photo}] = (await ask('germany')).results
		expect((await umbreld.client.search.insights.query({photoId: photo!.id})).place).toEqual({
			name: 'Munich',
			region: 'Bavaria',
			country: 'Germany',
		})
	})

	test('finds documents by what they say', async () => {
		// A PDF with a text layer, a Word document and a note
		const documents = `${umbreld.vm.dataDirectory}/home/Documents`
		await umbreld.vm.sshAsRoot(`
			mkdir -p '${documents}' && cd '${documents}'
			printf '%%!PS\\n/Helvetica findfont 14 scalefont setfont 72 720 moveto (The quarterly invoice for umbrellas is overdue) show showpage\\n' | ps2pdf - letter.pdf
			python3 -c "
import zipfile
with zipfile.ZipFile('minutes.docx', 'w') as docx:
	docx.writestr('word/document.xml', '<w:document><w:body><w:p><w:r><w:t>The committee voted to plant an orchard of pear trees.</w:t></w:r></w:p></w:body></w:document>')
"
			echo 'Remember to feed the tortoise twice a week while we are away.' > note.txt
			chown -R 1000:1000 .
		`)

		// By a word in each
		await pRetry(async () => {
			expect(found(await searchEverything('umbrellas'))[0]).toBe('letter.pdf: document by text')
			expect(found(await searchEverything('orchard'))[0]).toBe('minutes.docx: document by text')
			expect(found(await searchEverything('tortoise'))[0]).toBe('note.txt: document by text')
		}, whenRead)
		const [letter] = await searchEverything('umbrellas')
		expect(letter).toMatchObject({page: 1, snippet: {text: 'The quarterly invoice for umbrellas is overdue'}})

		// By what one says, in other words
		expect(found(await searchEverything('looking after a pet reptile'))[0]).toBe('note.txt: document by text')

		// And still by name, as Files finds it, before anything in it
		expect(found(await searchEverything('minutes'))[0]).toBe('minutes.docx: document by name')

		// What a document says is told to whoever is looking at it
		const insights = await umbreld.client.search.insights.query({path: '/Home/Documents/note.txt'})
		expect(insights.text).toContain('feed the tortoise')
	})

	test('reads a web page and a Rich Text document for what they say, and leaves data alone', async () => {
		await write(
			'Documents/log.html',
			`<html><head><title>Station</title><style>p {color: maroon}</style><script>var hidden = 'semaphore'</script></head>
			<body><h1>Keeper&#39;s log</h1><p>The lighthouse lamp was trimmed at dusk &amp; the fog signal sounded.</p>
			<p title="a > b">Supper was cr&egrave;me br&ucirc;l&eacute;e.</p></body></html>`,
		)
		await write(
			'Documents/almanac.rtf',
			String.raw`{\rtf1\ansi{\fonttbl{\f0 Helvetica;}}{\info{\title Wormwood}}\f0\fs24 Prune the quince in \b February\b0  and again in caf\'e9 weather.\par}`,
		)
		await write('Documents/ledger.csv', 'date,item,amount\n2026-03-02,zeppelin ticket,45.00\n')
		// Written before everything was UTF-8: Rich Text in the Cyrillic code
		// page, and a note as Windows wrote one
		await write('Documents/privet.rtf', String.raw`{\rtf1\ansi\ansicpg1251 \'cf\'f0\'e8\'e2\'e5\'f2 \'ec\'e8\'f0\par}`)
		await write('Documents/menu.txt', Buffer.from('Soupe à l’oignon gratinée', 'latin1'))

		await pRetry(async () => {
			expect(found(await searchEverything('lighthouse'))[0]).toBe('log.html: document by text')
			expect(found(await searchEverything('quince'))[0]).toBe('almanac.rtf: document by text')
		}, whenRead)

		// The text, and none of what only says how it looks or works
		const page = await umbreld.client.search.insights.query({path: '/Home/Documents/log.html'})
		expect(page.text).toContain("Keeper's log")
		expect(page.text).toContain('trimmed at dusk & the fog signal')
		expect(page.text).toContain('Supper was crème brûlée.')
		expect(page.text).not.toMatch(/maroon|semaphore|<p>|a > b/)
		const almanac = await umbreld.client.search.insights.query({path: '/Home/Documents/almanac.rtf'})
		expect(almanac.text).toContain('Prune the quince in February and again in café weather.')
		expect(almanac.text).not.toMatch(/Helvetica|Wormwood|fs24/)

		await pRetry(async () => {
			expect(found(await searchEverything('Привет'))[0]).toBe('privet.rtf: document by text')
			expect(found(await searchEverything('gratinée'))[0]).toBe('menu.txt: document by text')
		}, whenRead)

		// A table of data is found by its name, and not read
		expect(found(await searchEverything('ledger'))[0]).toBe('ledger.csv: file by name')
		expect(found(await searchEverything('zeppelin')).filter((result) => result.startsWith('ledger'))).toEqual([])
		expect(await umbreld.client.search.insights.query({path: '/Home/Documents/ledger.csv'})).toEqual({})
	})

	test('reads a scanned document, which is only pictures of its pages', async () => {
		// Three pages: one with its text in it, one a picture of some, and one a
		// picture that says it is 200 inches square, which is made no larger
		// than a page of A0 and not left unread
		await umbreld.vm.sshAsRoot(`
			cd '${umbreld.vm.dataDirectory}/home/Documents'
			printf '%%!PS\\n/Helvetica findfont 14 scalefont setfont 72 720 moveto (Instructions for the samovar) show showpage\\n' | ps2pdf - typed.pdf
			convert -size 1240x1754 xc:white -pointsize 44 -fill black \\
				-annotate +120+300 'Warranty for the dishwasher' -annotate +120+380 'Keep this receipt for five years' receipt.png
			convert receipt.png receipt.pdf
			convert -size 2000x2000 xc:white -pointsize 150 -fill black -annotate +150+600 'Deed of the allotment' \\
				-units PixelsPerInch -density 10 deed.png
			convert deed.png deed.pdf
			pdfunite typed.pdf receipt.pdf deed.pdf manual.pdf
			rm typed.pdf receipt.png receipt.pdf deed.png deed.pdf
			chown 1000:1000 manual.pdf
		`)

		await pRetry(
			async () => expect(found(await searchEverything('dishwasher'))[0]).toBe('manual.pdf: document by text'),
			whenRead,
		)
		// Each page is found where it is, however its words were got at
		expect((await searchEverything('dishwasher'))[0]).toMatchObject({page: 2})
		expect((await searchEverything('samovar'))[0]).toMatchObject({page: 1})
		await pRetry(async () => expect((await searchEverything('allotment'))[0]).toMatchObject({page: 3}), whenRead)
		const manual = await umbreld.client.search.insights.query({path: '/Home/Documents/manual.pdf'})
		expect(manual.text).toContain('Instructions for the samovar')
		expect(manual.text).toContain('Keep this receipt for five years')
	})

	test('finds a word inside text that is written without spaces', async () => {
		await write(
			'Documents/travel.txt',
			'去年在北京拍的照片都放在这里。\n\n東京タワーに行きました。\n\n서울에서 찍은 사진입니다.',
		)
		await write('Documents/weather.txt', 'วันนี้อากาศดีมากเราไปเดินเล่นที่สวนสาธารณะ')

		await pRetry(async () => {
			expect(found(await searchEverything('北京'))[0]).toBe('travel.txt: document by text')
			expect(found(await searchEverything('อากาศ'))[0]).toBe('weather.txt: document by text')
		}, whenRead)
		// Chinese, Japanese and Korean, each a word from the middle of a sentence
		for (const word of ['照片', 'タワー', '서울', '사진']) {
			const [first] = await searchEverything(word)
			expect(first).toMatchObject({file: {name: 'travel.txt'}, match: 'text'})
			expect(first.snippet!.text).toContain(word)
		}
		// Thai
		expect(found(await searchEverything('สวนสาธารณะ'))[0]).toBe('weather.txt: document by text')
		// Characters that are in a text, but not side by side, are not a word in
		// it: nothing is shown as having them, whatever is found by its meaning
		const shown = async (text: string) =>
			(await searchEverything(text)).filter(({snippet}) => snippet?.highlights.length).map(({file}) => file.name)
		expect(await shown('京北')).toEqual([])
		// With a word of another script, both have to be there
		await write('Documents/trip.txt', 'Our itinerary for 北京 in the spring.')
		await pRetry(async () => expect(await shown('itinerary 北京')).toEqual(['trip.txt']), whenRead)
	})

	test('finds a file by its name, mistyped or not, and not by one that only resembles it', async () => {
		await write('Documents/minuscule.txt', 'A note about nothing in particular.')
		await pRetry(
			async () => expect(found(await searchEverything('minuscule'))[0]).toBe('minuscule.txt: document by name'),
			whenRead,
		)

		// As it is called
		expect(found(await searchEverything('minutes'))[0]).toBe('minutes.docx: document by name')
		// With two letters the wrong way round
		expect(found(await searchEverything('minuets'))).toContain('minutes.docx: document by name')
		// Files' own search is generous about what looks like a name. A name that
		// only begins the same way is not a match for what was typed.
		const byName = (results: string[]) => results.filter((result) => result.endsWith('by name'))
		expect(byName(found(await searchEverything('minutes')))).toEqual(['minutes.docx: document by name'])
		expect(byName(found(await searchEverything('minuets')))).toEqual(['minutes.docx: document by name'])
	})

	test('finds a recording and a video by what is said in them', async () => {
		// Seven seconds of someone reading aloud (a LibriVox recording, by way of
		// LibriSpeech, CC BY 4.0), as a recording and as the sound of a video
		const speech = await fse.readFile(nodePath.resolve(__dirname, 'fixtures/speech.opus'))
		const recordings = `${umbreld.vm.dataDirectory}/home/Recordings`
		await umbreld.vm.sshAsRoot(`
			mkdir -p '${recordings}' && cd '${recordings}'
			echo '${speech.toString('base64')}' | base64 -d > reading.opus
			ffmpeg -nostdin -loglevel error -loop 1 -i '${directory()}/picture-three.png' -i reading.opus \
				-shortest -pix_fmt yuv420p -r 5 '${directory()}/reading.mp4'
			chown -R 1000:1000 . '${directory()}/reading.mp4'
		`)

		// The words themselves come before anything that only looks like them
		const said = async () => (await searchEverything('yellow lamps')).filter(({match}) => match === 'speech')
		await pRetry(async () => {
			expect(found(await said()).sort()).toEqual(['reading.mp4: video by speech', 'reading.opus: audio by speech'])
		}, whenRead)
		expect((await searchEverything('yellow lamps')).slice(0, 2).map(({match}) => match)).toEqual(['speech', 'speech'])

		// Each opens where it is said, and says the rest to whoever is looking
		for (const result of await said()) expect(result.moment?.startMs).toBeLessThan(2000)
		const insights = await umbreld.client.search.insights.query({path: '/Home/Recordings/reading.opus'})
		expect(insights.transcript?.[0]?.text).toContain('yellow lamps')
		// ... a sentence at a time, each with when it is said. (There is no GPU
		// here to write it down on, so the models were asked for one, said so,
		// and wrote it on the CPU.)
		const transcript = insights.transcript!
		expect(transcript.map(({text}) => text).join(' ')).toMatch(/^[A-Z].*[.?!]$/)
		for (const [index, {startMs, endMs}] of transcript.entries()) {
			expect(startMs).toBeGreaterThanOrEqual(transcript[index - 1]?.endMs ?? 0)
			expect(endMs).toBeGreaterThan(startMs)
			expect(endMs).toBeLessThan(8000)
		}

		// In Photos, the video and not the recording
		expect((await search('yellow lamps'))[0]).toBe('reading.mp4')

		// What kind of thing is looked for is read out of what was typed, and is not a word to find
		const videos = await umbreld.client.search.query.query({query: 'videos', scope: 'photos', limit: 20})
		expect(videos.understood).toMatchObject({chips: [{type: 'kind', kind: 'video'}], text: ''})
		expect(videos.results.map(({file}) => file.name)).toContain('reading.mp4')
		expect(videos.results.every(({kind}) => kind === 'video')).toBe(true)
		expect(await search('yellow lamps')).not.toContain('reading.opus')
	})

	test('finds what is said in Hindi, however it is spelt', async () => {
		// Six seconds of someone reading aloud in Hindi (from Google's FLEURS, CC
		// BY 4.0): "कुतूहल गांव में आधे घंटे टहलना समय की हानि नहीं है"
		await write('Recordings/hindi.opus', await fse.readFile(nodePath.resolve(__dirname, 'fixtures/speech-hindi.opus')))
		const transcript = async () =>
			(await umbreld.client.search.insights.query({path: '/Home/Recordings/hindi.opus'})).transcript ?? []

		// It is written down in the Latin letters Hindi is typed in
		await pRetry(async () => expect((await transcript()).map(({text}) => text).join(' ')).toMatch(/ghante/), whenRead)
		expect((await transcript()).map(({text}) => text).join(' ')).toMatch(/^[a-z0-9 .,?!'-]+$/i)

		// ... and found by them, spelt as anyone might spell them, where it is said
		for (const typed of ['aadhe ghante', 'adhe ghante', 'aadhay ghnte']) {
			const [first] = await searchEverything(typed)
			expect(first).toMatchObject({file: {name: 'hindi.opus'}, match: 'speech'})
			expect(first!.snippet!.highlights).toHaveLength(2)
			expect(first!.moment!.startMs).toBeLessThan(2000)
		}
		// ... and as it is written in Devanagari
		expect((await searchEverything('आधे घंटे'))[0]).toMatchObject({file: {name: 'hindi.opus'}, match: 'speech'})
	})

	test('leaves a film in Downloads unwritten, where the apps that fetch them put them', async () => {
		// Twenty-one minutes of the same reading over a plain picture, which is a
		// film as far as its length goes, and seven seconds of it beside it
		const home = `${umbreld.vm.dataDirectory}/home`
		await umbreld.vm.sshAsRoot(`
			mkdir -p '${home}/Downloads/Films' && cd '${home}/Downloads'
			ffmpeg -nostdin -loglevel error -f lavfi -i color=c=0x808080:s=320x240:r=1 				-stream_loop 179 -i '${home}/Recordings/reading.opus' -shortest -pix_fmt yuv420p Films/film.mp4
			ffmpeg -nostdin -loglevel error -f lavfi -i color=c=0x606060:s=320x240:r=1 				-i '${home}/Recordings/reading.opus' -shortest -pix_fmt yuv420p clip.mp4
			chown -R 1000:1000 .
		`)

		// The short one is found by what is said in it, like any other video
		const said = async () => found((await searchEverything('yellow lamps')).filter(({match}) => match === 'speech'))
		await pRetry(async () => {
			expect(await said()).toContain('clip.mp4: video by speech')
			const {indexing} = await umbreld.client.search.status.query()
			expect(indexing.completed).toBe(indexing.total)
		}, whenRead)

		// The film has been read for all it is going to be, and what is said in
		// it was not written down
		expect(await said()).not.toContain('film.mp4: video by speech')
		const insights = await umbreld.client.search.insights.query({path: '/Home/Downloads/Films/film.mp4'})
		expect(insights.transcript ?? []).toEqual([])
	})

	test('shows nothing for a description that fits no photo', async () => {
		expect(await search('a dog running on a beach')).toEqual([])
	})

	test('still finds a photo by its name', async () => {
		expect(await search('picture-two')).toEqual(['picture-two.png'])
	})

	test('searches only the view it is asked to', async () => {
		// The blue circle is the only favourite
		const [circle] = (await umbreld.client.photos.items.list.query({filter: {query: 'picture-two'}})).items
		await umbreld.client.photos.items.setFavorite.mutate({ids: [circle!.id], favorite: true})

		// Described among the favourites, it is found and the red square is not
		expect(await search('a blue circle', {favorite: true})).toEqual(['picture-two.png'])
		expect(await search('a red square', {favorite: true})).toEqual([])
	})

	test('gathers the photos one person is in', async () => {
		// The same portrait three times over: as it is, brighter and smaller,
		// and mirrored. (Eileen Collins, a NASA photograph in the public domain.)
		const portrait = await fse.readFile(nodePath.resolve(__dirname, 'fixtures/portrait.jpg'))
		await umbreld.vm.sshAsRoot(`
			cd '${directory()}'
			echo '${portrait.toString('base64')}' | base64 -d > portrait-one.jpg
			convert portrait-one.jpg -modulate 115 -resize 80% portrait-two.jpg
			convert portrait-one.jpg -flop portrait-three.jpg
			chown 1000:1000 portrait-*.jpg
		`)
		const people = () => umbreld.client.photos.people.list.query()
		const namesOf = async (items: Array<{id: string}>) =>
			(await Promise.all(items.map(({id}) => umbreld.client.photos.items.get.query({id}))))
				.map((item) => item.fileName)
				.sort()

		// Seen three times, the face is someone, and nothing else in the library is anyone
		const person = await pRetry(async () => {
			const everyone = await people()
			expect(everyone).toMatchObject([{count: 3, isHidden: false}])
			return everyone[0]!
		}, whenRead)
		personId = person.id
		const theirs = await umbreld.client.photos.items.list.query({filter: {personIds: [person.id]}})
		expect(await namesOf(theirs.items)).toEqual(['portrait-one.jpg', 'portrait-three.jpg', 'portrait-two.jpg'])

		// Named, they are named wherever they are shown, and their face is pointed at
		await umbreld.client.photos.people.rename.mutate({id: person.id, name: 'Eileen'})
		expect(await people()).toMatchObject([{id: person.id, name: 'Eileen', count: 3}])
		const cover = await umbreld.client.photos.items.get.query({id: person.cover.itemId})
		expect(cover.people).toMatchObject([{id: person.id, name: 'Eileen'}])
		expect(cover.people[0]!.face.width).toBeGreaterThan(0.1)
		// ... and found by their name, which is read as who is looked for
		const theirsByName = await umbreld.client.search.query.query({query: 'eileen', scope: 'photos', limit: 20})
		expect(theirsByName.understood).toMatchObject({chips: [{type: 'person', label: 'Eileen', personId: person.id}]})
		expect(theirsByName.results.map(({file}) => file.name).sort()).toEqual([
			'portrait-one.jpg',
			'portrait-three.jpg',
			'portrait-two.jpg',
		])

		// "Not this person" takes them off a photo for good
		await umbreld.client.photos.people.removeItems.mutate({id: person.id, ids: [person.cover.itemId]})
		expect(await people()).toMatchObject([{id: person.id, count: 2}])
		expect((await umbreld.client.photos.items.get.query({id: person.cover.itemId})).people).toEqual([])

		// Hidden, they are only listed when asked for
		await umbreld.client.photos.people.setHidden.mutate({id: person.id, hidden: true})
		expect(await people()).toEqual([])
		expect(await umbreld.client.photos.people.list.query({hidden: true})).toMatchObject([{id: person.id}])
	})

	test('answers an agent that has been given all of Home by what is in things too, and Photos only with Photos', async () => {
		const credential = await umbreld.client.mcp.enable.mutate({label: 'Search test', agentType: 'generic'})
		agentToken = credential!.token
		const permissions = {
			apps: [],
			appStore: false,
			files: ['/Home'],
			manageSystem: false,
			machines: [],
			createMachines: false,
			photos: false,
		}
		await umbreld.client.mcp.setPermissions.mutate(permissions)

		// All of Home without Photos finds photos as files, and not the library
		const asFiles = await askAgent('hovercraft')
		expect(asFiles.files).toContainEqual(
			expect.objectContaining({name: 'sign.png', path: '/Home/Photos/sign.png', match: 'text'}),
		)
		for (const file of asFiles.files) expect(file).not.toHaveProperty('photoId')
		await expect(askAgent('hovercraft', 'photos')).rejects.toThrow('Photos access')
		await expect(agent('list_photos')).rejects.toThrow()
		await umbreld.client.mcp.setPermissions.mutate({...permissions, photos: true})

		// By the words in a picture, with why it is found
		const sign = await askAgent('hovercraft', 'photos')
		expect(sign.files).toMatchObject([{name: 'sign.png', path: '/Home/Photos/sign.png', match: 'text'}])
		expect(sign.totalFiles).toBe(1)
		// By what is said, with where in it, and nothing of what was said
		const said = await askAgent('yellow lamps')
		const spoken = said.files.filter(({match}) => match === 'speech')
		expect(spoken.map(({name}) => name)).toEqual(expect.arrayContaining(['reading.mp4', 'reading.opus']))
		for (const file of spoken) expect(file.moment!.startMs).toBeLessThan(2000)
		expect(JSON.stringify(said)).not.toMatch(/lamps/)
		// In Photos, who, when and where are read out of what was typed, and it says which
		const there = await askAgent('germany', 'photos')
		expect(there.files.map(({name}) => name)).toEqual(['german.jpg'])
		expect(there.filters).toEqual([{type: 'place', label: 'Germany'}])
	})

	test('lets an agent gather photos into albums, mark them and take them away, by what a search names them', async () => {
		type Photos = {photos: Array<{photoId: string}>}
		const ids = async (input: Record<string, unknown>) =>
			(await agent<Photos>('list_photos', input)).photos.map(({photoId}) => photoId)
		const albums = async () =>
			(await agent<{albums: Array<{name: string}>}>('list_albums')).albums.map(({name}) => name)
		const [{photoId}] = (await askAgent('hovercraft', 'photos')).files
		expect(photoId).toBeTruthy()

		// An album of what was found, which can be given another name
		const album = await agent<{albumId: string; name: string; photos: number}>('create_album', {
			name: 'Signs',
			photoIds: [photoId],
		})
		expect(album).toMatchObject({name: 'Signs', photos: 1})
		expect(await ids({albumId: album.albumId})).toEqual([photoId])
		expect(await agent('update_album', {albumId: album.albumId, name: 'Painted signs'})).toMatchObject({
			name: 'Painted signs',
		})

		// A favourite, and what is known of it, which is nothing of what it shows
		await agent('set_photos_favorite', {photoIds: [photoId], favorite: true})
		expect(await ids({favorite: true})).toContain(photoId)
		expect(await agent('get_photo', {photoId})).toMatchObject({
			name: 'sign.png',
			path: '/Home/Photos/sign.png',
			favorite: true,
			albums: [{albumId: album.albumId, name: 'Painted signs'}],
		})
		await agent('set_photos_favorite', {photoIds: [photoId], favorite: false})
		expect(await ids({favorite: true})).not.toContain(photoId)

		// Out of the album, and the album gone, the photo is where it was
		await agent('remove_photos_from_album', {albumId: album.albumId, photoIds: [photoId]})
		expect(await ids({albumId: album.albumId})).toEqual([])
		await agent('delete_album', {albumId: album.albumId})
		expect(await albums()).not.toContain('Painted signs')
		expect((await askAgent('hovercraft', 'photos')).files).toMatchObject([{name: 'sign.png'}])

		// Who is in the library, by the name the owner gave them (hidden, by now), and the photos they are in
		const {people} = await agent<{people: Array<{personId: string; name?: string; photos: number}>}>('list_people', {
			hidden: true,
		})
		expect(people).toMatchObject([{name: 'Eileen', photos: 2}])
		expect(await ids({personIds: [people[0]!.personId]})).toHaveLength(2)

		// A photo taken away goes to Recently Deleted, and is put back from there
		await umbreld.vm.sshAsRoot(
			`cd '${directory()}' && convert -size 640x480 xc:gray spare.png && chown 1000:1000 spare.png`,
		)
		const spare = await pRetry(async () => {
			const [found] = (await askAgent('spare', 'photos')).files
			expect(found).toMatchObject({name: 'spare.png', photoId: expect.any(String)})
			return found!.photoId!
		}, whenRead)
		expect(await agent('trash_photos', {photoIds: [spare]})).toEqual({moved: 1})
		await pRetry(async () => expect(await ids({deleted: true})).toContain(spare), whenRead)
		expect((await askAgent('spare', 'photos')).files).toEqual([])
		expect(await agent('restore_photos', {photoIds: [spare]})).toEqual({restored: 1})
		await pRetry(
			async () => expect((await askAgent('spare', 'photos')).files).toMatchObject([{name: 'spare.png'}]),
			whenRead,
		)
	})

	test("does not find or touch another account's things", async () => {
		// A member with a note of their own, which says something the owner's letter says too
		const member = await umbreld.client.user.createUser.mutate({name: 'photo-member', password: memberPassword})
		const session = await login({userId: member.userId, password: memberPassword})
		await umbreld.setBrowserSession(session.token, session.cookies)
		await umbreld.api.post(`files/upload?path=${encodeURIComponent(`/Users/${member.userId}/mine.txt`)}`, {
			body: 'My umbrellas are in the cupboard under the stairs.',
		})

		// Their own is all they find
		await pRetry(
			async () => expect(found(await searchEverything('umbrellas'))).toEqual(['mine.txt: document by text']),
			whenRead,
		)
		// How far along the work is on their own file is what they are told, not on the owner's library
		const theirs = (await umbreld.client.search.status.query()).indexing
		expect(theirs.total).toBeGreaterThan(0)
		// ... and an agent, which is let in as the owner, does not find it
		const asOwner = await askAgent('umbrellas')
		expect(asOwner.files.length).toBeGreaterThan(0)
		expect(asOwner.files.map(({name}) => name)).not.toContain('mine.txt')
		expect(await search('a red square')).toEqual([])
		// Where the owner has been is not a place to them
		expect(await umbreld.client.search.query.query({query: 'thailand', scope: 'photos'})).toMatchObject({
			understood: {chips: []},
			results: [],
		})
		expect(await searchEverything('yellow lamps')).toEqual([])
		expect(await umbreld.client.search.insights.query({photoId: signId})).toEqual({})
		expect(await umbreld.client.search.insights.query({path: '/Home/Documents/note.txt'}).catch(() => ({}))).toEqual({})
		expect((await still(stillPath)).statusCode).not.toBe(200)

		// The owner's people are not theirs to see, to list photos by, or to change
		expect(await umbreld.client.photos.people.list.query({hidden: true})).toEqual([])
		expect((await umbreld.client.photos.items.list.query({filter: {personIds: [personId]}})).items).toEqual([])
		await umbreld.client.photos.people.rename.mutate({id: personId, name: 'Mallory'}).catch(() => {})
		await umbreld.client.photos.people.setHidden.mutate({id: personId, hidden: false}).catch(() => {})

		// And the owner finds their own as before, and nothing of the member's
		await umbreld.setBrowserSession(owner.token, owner.cookies)
		expect(await search('a red square')).toEqual(['picture-one.png'])
		expect((await umbreld.client.search.status.query()).indexing.total).toBeGreaterThan(theirs.total)
		const umbrellas = found(await searchEverything('umbrellas'))
		expect(umbrellas[0]).toBe('letter.pdf: document by text')
		expect(umbrellas).not.toContain('mine.txt: document by text')
		expect(await umbreld.client.photos.people.list.query({hidden: true})).toMatchObject([
			{id: personId, name: 'Eileen', isHidden: true},
		])
	})

	test('goes by name alone while the model cannot be asked', async () => {
		await umbreld.vm.sshAsRoot('systemctl stop umbrel-embeddings-query.socket umbrel-embeddings-query.service')

		expect(await search('picture-two')).toEqual(['picture-two.png'])
		expect(await search('a blue circle')).toEqual([])

		// Words are still found as words
		expect(await search('hovercraft')).toEqual(['sign.png'])
	})
})
