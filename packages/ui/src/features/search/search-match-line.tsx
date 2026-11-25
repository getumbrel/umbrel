import {useMemo} from 'react'
import {useTranslation} from 'react-i18next'

import {cn} from '@/lib/utils'

import {folderTrail, formatMoment} from './format'
import {hasHighlight, snippetSegments} from './snippet'
import type {SearchResult, SearchSnippetText} from './types'

// What a result's one line has to say about why it is here:
//   words    the words found inside it, led by where they are (a page, a moment)
//   moment   a point in a video or recording with no words to show: what was
//            said there, or what it looks like there
//   picture  text read off a photo that matched by what it means — the raw
//            reading is rarely worth showing, so the line only says it is there
//   page     a page of a document that matched by how it looks
//   folder   anything else (a name, a look-alike): where the file lives
export type MatchReason =
	| {type: 'words'; snippet: SearchSnippetText; momentMs?: number; page?: number}
	| {type: 'moment'; momentMs: number; spoken: boolean}
	| {type: 'picture'}
	| {type: 'page'; page: number}
	| {type: 'folder'}

export function matchReason({kind, match, snippet, moment, page}: SearchResult): MatchReason {
	if (snippet) {
		if (kind === 'photo' && !hasHighlight(snippet)) return {type: 'picture'}
		return {type: 'words', snippet, momentMs: moment?.startMs, page}
	}
	if (moment) return {type: 'moment', momentMs: moment.startMs, spoken: match === 'speech'}
	if (page !== undefined) return {type: 'page', page}
	return {type: 'folder'}
}

// One line that says why a result is here (see matchReason)
export function SearchMatchLine({result, className}: {result: SearchResult; className?: string}) {
	const {t} = useTranslation()
	const reason = matchReason(result)
	return <span className={cn('block truncate', className)}>{line()}</span>

	function line() {
		switch (reason.type) {
			case 'words': {
				const where =
					reason.momentMs !== undefined ? (
						<span className='text-white/75 tabular-nums'>{formatMoment(reason.momentMs)}</span>
					) : reason.page !== undefined ? (
						<span className='text-white/75'>{t('search.page', {page: reason.page})}</span>
					) : null
				return (
					<>
						{where}
						{where && (
							<span aria-hidden='true' className='px-1.5 opacity-60'>
								·
							</span>
						)}
						<Snippet snippet={reason.snippet} />
					</>
				)
			}
			case 'moment': {
				const time = formatMoment(reason.momentMs)
				return (
					<span className='tabular-nums'>
						{reason.spoken ? t('search.said-at', {time}) : t('search.seen-at', {time})}
					</span>
				)
			}
			case 'picture':
				return t('search.text-in-photo')
			case 'page':
				return t('search.page', {page: reason.page})
			case 'folder':
				return <FolderTrail path={result.file.path} />
		}
	}
}

// The words around a match, the match itself in the match colour. Meant for one
// truncated line: the text opens near the first highlight (see
// snippetSegments), and the line's `truncate` cuts the far end.
function Snippet({snippet}: {snippet: SearchSnippetText}) {
	const segments = useMemo(() => snippetSegments(snippet), [snippet])
	return (
		<span>
			{segments.map((segment, index) =>
				segment.highlighted ? (
					<mark key={index} className='bg-transparent font-semibold text-match'>
						{segment.text}
					</mark>
				) : (
					segment.text
				),
			)}
		</span>
	)
}

function FolderTrail({path}: {path: string}) {
	const {folders, clipped} = folderTrail(path)
	const parts = clipped ? ['…', ...folders] : folders
	return (
		<>
			{parts.map((folder, index) => (
				<span key={index}>
					{index > 0 && (
						<span aria-hidden='true' className='px-1 opacity-50'>
							›
						</span>
					)}
					{folder}
				</span>
			))}
		</>
	)
}
