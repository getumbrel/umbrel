import {Check, ChevronDown} from 'lucide-react'
import {useTranslation} from 'react-i18next'

import {AppIcon} from '@/components/app-icon'
import {OrbGlyph} from '@/components/orb/orb'
import type {OrbPalette} from '@/components/orb/orb-palette'
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from '@/components/ui/dropdown-menu'
import {cn} from '@/lib/utils'
import {systemAppsKeyed} from '@/providers/apps'

// Where a search looks. "Everywhere" is the default and asks every source at
// once; the others narrow to one app and get more of its results.
export type CmdkDomain = 'everywhere' | 'files' | 'photos' | 'app-store' | 'settings'

export const CMDK_DOMAINS: readonly CmdkDomain[] = ['everywhere', 'files', 'photos', 'app-store', 'settings']

const DOMAIN_APP = {
	files: 'UMBREL_files',
	photos: 'UMBREL_photos',
	'app-store': 'UMBREL_app-store',
	settings: 'UMBREL_settings',
} as const

export function cmdkDomainIcon(domain: Exclude<CmdkDomain, 'everywhere'>) {
	return systemAppsKeyed[DOMAIN_APP[domain]].icon
}

export function nextCmdkDomain(domain: CmdkDomain, step: 1 | -1): CmdkDomain {
	const index = CMDK_DOMAINS.indexOf(domain)
	return CMDK_DOMAINS[(index + step + CMDK_DOMAINS.length) % CMDK_DOMAINS.length]
}

// Literal t() calls per domain: the locale pruner scans for key strings
export function useCmdkDomainCopy() {
	const {t} = useTranslation()
	const label = (domain: CmdkDomain) => {
		switch (domain) {
			case 'everywhere':
				return t('cmdk.domain.everywhere')
			case 'files':
				return t('cmdk.domain.files')
			case 'photos':
				return t('cmdk.domain.photos')
			case 'app-store':
				return t('cmdk.domain.app-store')
			case 'settings':
				return t('cmdk.domain.settings')
		}
	}
	const placeholder = (domain: CmdkDomain) => {
		switch (domain) {
			case 'everywhere':
				return t('cmdk.placeholder.everywhere')
			case 'files':
				return t('cmdk.placeholder.files')
			case 'photos':
				return t('cmdk.placeholder.photos')
			case 'app-store':
				return t('cmdk.placeholder.app-store')
			case 'settings':
				return t('cmdk.placeholder.settings')
		}
	}
	return {label, placeholder}
}

export function CmdkDomainIcon({
	domain,
	size,
	palette,
	className,
}: {
	domain: CmdkDomain
	size: number
	palette: OrbPalette
	className?: string
}) {
	if (domain === 'everywhere') return <OrbGlyph palette={palette} size={size} className={className} />
	return (
		<AppIcon
			src={cmdkDomainIcon(domain)}
			size={size}
			className={cn('rounded-[22%] border-0 bg-transparent', className)}
		/>
	)
}

// The scope chip at the end of the search field. Tab cycles it from the
// keyboard; the menu is for the mouse and for seeing what's on offer.
export function CmdkDomainChip({
	domain,
	palette,
	onChange,
	onCloseAutoFocus,
}: {
	domain: CmdkDomain
	palette: OrbPalette
	onChange: (domain: CmdkDomain) => void
	onCloseAutoFocus: () => void
}) {
	const {t} = useTranslation()
	const {label} = useCmdkDomainCopy()
	return (
		<DropdownMenu modal={false}>
			<DropdownMenuTrigger asChild>
				<button
					type='button'
					aria-label={t('cmdk.search-in', {domain: label(domain)})}
					className='flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-white/6 py-1 pr-2 pl-2 text-12 font-medium -tracking-2 whitespace-nowrap text-white/85 outline-hidden transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-white/12 data-[state=open]:text-white'
				>
					<CmdkDomainIcon domain={domain} size={16} palette={palette} />
					<span>{label(domain)}</span>
					<ChevronDown className='size-3.5 text-white/45' />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align='end'
				sideOffset={8}
				className='z-[1000] min-w-[184px] p-1.5'
				onCloseAutoFocus={(event) => {
					// Back to the field, not the chip
					event.preventDefault()
					onCloseAutoFocus()
				}}
			>
				{CMDK_DOMAINS.map((option) => (
					<DropdownMenuItem
						key={option}
						aria-current={option === domain ? 'true' : undefined}
						className='gap-2.5 py-2 pr-2.5 pl-2 text-13'
						onSelect={() => onChange(option)}
					>
						<CmdkDomainIcon domain={option} size={20} palette={palette} />
						<span className='flex-1'>{label(option)}</span>
						{option === domain && <Check className='size-4 text-white/70' aria-hidden='true' />}
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	)
}
