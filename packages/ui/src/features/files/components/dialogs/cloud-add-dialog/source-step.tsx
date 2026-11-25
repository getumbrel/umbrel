import {MoreHorizontal} from 'lucide-react'
import {AnimatePresence, motion, useReducedMotion} from 'motion/react'
import {useState} from 'react'
import {useTranslation} from 'react-i18next'

import {Button} from '@/components/ui/button'
import {CloudAccountDialog} from '@/features/files/components/cloud-account-dialog'
import {CloudDisconnectDialog} from '@/features/files/components/cloud-disconnect-dialog'
import {
	CloudConstellation,
	CloudPitchPoints,
	type CloudPickerSelection,
} from '@/features/files/components/shared/cloud-constellation'
import {CLOUD_PROVIDER_LOGOS} from '@/features/files/constants'
import {useCloudSyncs, type CloudAccount, type CloudProvider} from '@/features/files/hooks/use-cloud'
import {cloudAccountBrand, cloudBrandName} from '@/features/files/utils/cloud'

export function SourceStep({
	providers,
	accounts,
	isLoading,
	view,
	onEnterPicker,
	onSelectAccount,
	onReauthAccount,
	onSelect,
}: {
	providers?: CloudProvider[]
	accounts?: CloudAccount[]
	isLoading: boolean
	view: 'pitch' | 'picker'
	onEnterPicker: () => void
	onSelectAccount: (account: CloudAccount) => void
	onReauthAccount: (account: CloudAccount) => void
	onSelect: (selection: CloudPickerSelection) => void
}) {
	const {t} = useTranslation()
	const reducedMotion = useReducedMotion() ?? false
	const {data: clouds} = useCloudSyncs()
	const [managing, setManaging] = useState<CloudAccount | null>(null)
	const [disconnecting, setDisconnecting] = useState<CloudAccount | null>(null)

	if (isLoading) return <SourceSkeleton />

	const hasAccounts = (accounts?.length ?? 0) > 0
	const isPitch = view === 'pitch'

	return (
		<div className='space-y-5 py-2'>
			{hasAccounts && !isPitch && (
				<div className='space-y-2'>
					<p className='text-13 text-white/60'>{t('files-cloud.source-choose-account')}</p>
					<div className='divide-y divide-white/6 overflow-hidden rounded-xl border border-white/10 bg-white/5'>
						{accounts?.map((account) => (
							<AccountRow
								key={account.id}
								account={account}
								providerName={cloudBrandName(cloudAccountBrand(account), providers) ?? account.provider}
								onSelect={() => onSelectAccount(account)}
								onManage={() => setManaging(account)}
							/>
						))}
					</div>
				</div>
			)}

			<div className='space-y-2'>
				{hasAccounts && !isPitch && <p className='text-13 text-white/60'>{t('files-cloud.source-connect-new')}</p>}
				<CloudConstellation providers={providers} view={view} onSelect={onSelect} />
			</div>

			{/* Stacked over the wizard; signing in again continues inside it */}
			<CloudAccountDialog
				account={managing}
				onOpenChange={(open) => {
					if (!open) setManaging(null)
				}}
				onSignIn={(account) => {
					setManaging(null)
					onReauthAccount(account)
				}}
				onAddDownload={(account) => {
					setManaging(null)
					onSelectAccount(account)
				}}
				onDisconnect={(account) => {
					setManaging(null)
					setDisconnecting(account)
				}}
			/>
			<CloudDisconnectDialog
				account={disconnecting}
				clouds={clouds?.filter(({accountId}) => accountId === disconnecting?.id) ?? []}
				onOpenChange={(open) => {
					if (!open) setDisconnecting(null)
				}}
			/>

			{/* The pitch's promise and its single CTA make way once the picker unfolds.
			    On mount the copy arrives in soft beats: the heading lands alongside
			    the clouds, then the three points ease in close together, then the
			    invitation. */}
			<AnimatePresence>
				{isPitch && (
					<motion.div
						key='pitch-copy'
						initial={false}
						exit={{opacity: 0, transition: {duration: 0.15}}}
						className='flex flex-col items-center gap-5 px-4 pb-2 text-center'
					>
						<motion.p
							initial={reducedMotion ? false : {opacity: 0, y: 6}}
							animate={{opacity: 1, y: 0}}
							transition={{duration: 0.35, delay: 0.35}}
							className='text-19 font-semibold -tracking-2'
						>
							{t('files-cloud.pitch-title')}
						</motion.p>
						<CloudPitchPoints delay={0.55} />
						<motion.div
							initial={reducedMotion ? false : {opacity: 0, y: 4}}
							animate={{opacity: 1, y: 0}}
							transition={{duration: 0.4, delay: 0.85}}
						>
							<Button variant='primary' size='dialog' onClick={onEnterPicker}>
								{t('files-cloud.pitch-cta')}
							</Button>
						</motion.div>
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	)
}

function AccountRow({
	account,
	providerName,
	onSelect,
	onManage,
}: {
	account: CloudAccount
	providerName: string
	onSelect: () => void
	onManage: () => void
}) {
	const {t} = useTranslation()
	const needsAuth = account.attention?.kind === 'auth'

	return (
		<div
			role='button'
			tabIndex={0}
			onClick={onSelect}
			onKeyDown={(event) => {
				if (event.key === 'Enter' || event.key === ' ') {
					event.preventDefault()
					onSelect()
				}
			}}
			className='flex w-full cursor-pointer items-center gap-3 p-3 text-left transition-colors hover:bg-white/10 focus:outline-hidden focus-visible:bg-white/10'
		>
			<img
				src={CLOUD_PROVIDER_LOGOS[cloudAccountBrand(account)]}
				alt=''
				className='size-8 shrink-0 object-contain'
				draggable={false}
			/>
			<div className='min-w-0 flex-1'>
				<div className='truncate text-sm'>{account.displayName}</div>
				<div className='truncate text-12 text-white/50'>{providerName}</div>
			</div>
			{needsAuth && (
				<span className='flex shrink-0 items-center gap-1.5 text-12 text-white/50'>
					<span className='size-1.5 rounded-full bg-yellow-400' />
					<span className='max-sm:sr-only'>{t('files-cloud.manage-status-auth')}</span>
				</span>
			)}
			<button
				type='button'
				aria-label={t('files-cloud.manage')}
				onClick={(event) => {
					event.stopPropagation()
					onManage()
				}}
				className='shrink-0 rounded-full p-1.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white focus:outline-hidden focus-visible:bg-white/10 focus-visible:text-white'
			>
				<MoreHorizontal className='size-4' />
			</button>
		</div>
	)
}

// Tile-shaped placeholders while providers and accounts load
function SourceSkeleton() {
	return (
		<div className='grid grid-cols-3 gap-2 py-2'>
			{[0, 1, 2, 3, 4, 5].map((index) => (
				<div key={index} className='h-[88px] animate-pulse rounded-xl border border-white/10 bg-white/5' />
			))}
		</div>
	)
}
