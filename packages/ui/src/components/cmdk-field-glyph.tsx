import {Search as SearchIcon} from 'lucide-react'
import {useTranslation} from 'react-i18next'

import {useIsSmallMobile} from '@/hooks/use-is-mobile'
import {trpcReact} from '@/trpc/trpc'

import type {CmdkDomain} from './cmdk-domain'
import type {CmdkInsight} from './cmdk-sources'
import {SPARKLE_PATH} from './sparkle'

// The glyph leading the search field. A magnifier while the palette only
// matches names; Search's sparkle, with a small companion, once the query is
// put to Search's understanding. The two trade places like a symbol replace,
// in the same quiet tone: the sparkle is the field's icon, not a decoration.
export function CmdkFieldGlyph({insight}: {insight: CmdkInsight}) {
	return (
		<span
			className='cmdk-glyph relative block size-4'
			data-mode={insight.state === 'off' ? 'magnifier' : 'sparkle'}
			aria-hidden='true'
		>
			<SearchIcon className='cmdk-glyph-magnifier absolute inset-0 size-4' strokeWidth={2.25} />
			<svg viewBox='0 0 24 24' className='cmdk-glyph-sparkle absolute inset-0 size-4 overflow-visible'>
				{/* While the results were understood the stars glow in the orb's
				    colour: a soft copy of them behind, blooming out as they arrive */}
				<g className='cmdk-glyph-glow'>
					<Stars />
				</g>
				<Stars />
			</svg>
		</span>
	)
}

// The star, low and to the left; its companion, small, above it
function Stars() {
	return (
		<>
			<path d={SPARKLE_PATH} transform='translate(-1.2 2.4) scale(0.92)' />
			<path d={SPARKLE_PATH} transform='translate(14.4 -0.6) scale(0.4)' />
		</>
	)
}

// The empty field's placeholder where Search reads what is inside files:
// it says so. Until the status has answered that is assumed (most devices
// can), so the first open doesn't swap its text; a device whose Search only
// matches names keeps the domain's own placeholder. So does a phone for Files
// and Photos, where the longer sentence does not fit the field and, in a
// field that has the focus, is cut without an ellipsis.
export function useCmdkFieldPlaceholder({domain, open}: {domain: CmdkDomain; open: boolean}) {
	const {t} = useTranslation()
	const narrow = useIsSmallMobile()
	const status = trpcReact.search.status.useQuery(undefined, {enabled: open, retry: false})
	const readsContents = status.data ? status.data.available : !status.isError
	if (!readsContents) return undefined
	switch (domain) {
		case 'everywhere':
			return t('cmdk.placeholder-contents.everywhere')
		case 'files':
			return narrow ? undefined : t('cmdk.placeholder-contents.files')
		case 'photos':
			return narrow ? undefined : t('cmdk.placeholder-contents.photos')
		default:
			return undefined
	}
}
