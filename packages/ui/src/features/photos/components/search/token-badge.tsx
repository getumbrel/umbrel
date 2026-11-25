import {Album, Calendar, Globe, Image, MapPin, RectangleHorizontal, ScanLine, Video} from 'lucide-react'
import {useTranslation} from 'react-i18next'

import {LivePhotoIcon} from '@/features/photos/components/live-photo-icon'
import {PersonAvatar} from '@/features/photos/components/people/person-avatar'
import {SourceIcon} from '@/features/photos/components/sources/source-icon'
import type {SearchToken} from '@/features/photos/components/view-context'
import {usePeople} from '@/features/photos/hooks/use-people'
import {usePhotoSources} from '@/features/photos/hooks/use-photo-sources'
import {cn} from '@/lib/utils'

// How a search token looks wherever it appears — a suggestion, a chip in the
// field: its glyph (a person's own face, a
// source's own device) and its words.

// `size` is the artwork's side for the tokens drawn as pictures (a person, a source)
export function TokenIcon({token, className, size = 14}: {token: SearchToken; className?: string; size?: number}) {
	if (token.type === 'source') return <SearchSourceIcon id={token.id} size={size} />
	if (token.type === 'person') return <SearchPersonAvatar id={token.id} size={size + 2} />
	const Icon =
		token.type === 'date'
			? Calendar
			: token.type === 'album'
				? Album
				: token.type === 'place'
					? MapPin
					: token.type === 'subKind'
						? {live: LivePhotoIcon, panorama: RectangleHorizontal, screenshot: ScanLine, spherical: Globe}[
								token.subKind
							]
						: token.kind === 'video'
							? Video
							: Image
	return <Icon className={cn('size-3.5 shrink-0 opacity-60', className)} aria-hidden='true' />
}

// The same device artwork the sidebar shows for this source
function SearchSourceIcon({id, size}: {id: string; size: number}) {
	const {sources} = usePhotoSources()
	const type = sources.find((source) => source.id === id)?.type
	if (!type) return null
	return <SourceIcon type={type} size={size} />
}

// The person's own face; a quiet circle until the people list has it
function SearchPersonAvatar({id, size}: {id: string; size: number}) {
	const {people} = usePeople()
	const person = people.find((candidate) => candidate.id === id)
	if (!person) return <span className='shrink-0 rounded-full bg-white/10' style={{width: size, height: size}} />
	return <PersonAvatar person={person} size={size} />
}

export function tokenLabel(token: SearchToken, t: (key: string) => string) {
	if (token.type === 'kind') return token.kind === 'video' ? t('photos-sidebar.videos') : t('photos-sidebar.photos')
	return token.label
}

export function TokenLabel({token}: {token: SearchToken}) {
	const {t} = useTranslation()
	return <>{tokenLabel(token, t)}</>
}
