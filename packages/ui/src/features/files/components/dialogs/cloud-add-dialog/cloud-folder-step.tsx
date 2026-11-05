import {ChevronRight, CloudDownload, FolderSearch, Loader2, type LucideIcon} from 'lucide-react'
import {Trans, useTranslation} from 'react-i18next'

import {Button} from '@/components/ui/button'
import {DialogFooter} from '@/components/ui/dialog'
import {CloudLinkDiagram} from '@/features/files/components/shared/cloud-constellation'

export type CloudFolderState = 'loading' | 'busy' | 'auth' | 'error' | 'ready'

// One of the two ways to download: a large selectable card that acts on click
function ScopeOption({
	icon: Icon,
	title,
	description,
	onClick,
}: {
	icon: LucideIcon
	title: string
	description: string
	onClick: () => void
}) {
	return (
		<button
			type='button'
			onClick={onClick}
			className='flex w-full items-center gap-3.5 rounded-xl bg-white/5 p-4 text-left transition-colors hover:bg-white/10'
		>
			<Icon className='size-5 shrink-0 text-brand-lighter' />
			<span className='min-w-0 flex-1'>
				<span className='block text-sm font-medium'>{title}</span>
				<span className='block text-12 leading-relaxed text-white/50'>{description}</span>
			</span>
			<ChevronRight className='size-4 shrink-0 text-white/30' />
		</button>
	)
}

// displayName/logo come from the wizard so a Nextcloud/ownCloud flavored
// session keeps its own branding here, not the underlying webdav provider's.
// layoutKey continues the shared-element logo from the picker tile and the
// connect step, so one icon travels the whole journey.
export function CloudFolderStep({
	displayName,
	logo,
	layoutKey,
	morph,
	state,
	errorMessage,
	isPersonalOneDrive,
	onRetry,
	onOpenPicker,
	onDownloadAll,
	onSignIn,
	onBack,
}: {
	displayName: string
	logo: string
	layoutKey: string
	morph: boolean
	state: CloudFolderState
	errorMessage?: string
	isPersonalOneDrive: boolean
	onRetry: () => void
	onOpenPicker: () => void
	onDownloadAll: () => void
	onSignIn: () => void
	onBack: () => void
}) {
	const {t} = useTranslation()

	if (state === 'loading') {
		return (
			<div className='flex flex-col items-center gap-4 py-16 text-center'>
				<Loader2 className='size-5 animate-spin opacity-60' />
				<p className='text-13 text-white/60'>{t('files-cloud.folder-loading', {provider: displayName})}</p>
			</div>
		)
	}

	if (state === 'ready') {
		return (
			<div className='py-2'>
				<div className='flex flex-col items-center py-4'>
					<CloudLinkDiagram layoutKey={layoutKey} logo={logo} morph={morph} />
				</div>
				<div className='mx-auto flex max-w-[400px] flex-col gap-2 pt-2'>
					<ScopeOption
						icon={FolderSearch}
						title={t('files-cloud.folder-choose-specific')}
						description={t('files-cloud.folder-choose-specific-description', {provider: displayName})}
						onClick={onOpenPicker}
					/>
					<div className='space-y-2'>
						<ScopeOption
							icon={CloudDownload}
							title={t('files-cloud.folder-download-all')}
							description={t('files-cloud.folder-download-all-description', {provider: displayName})}
							onClick={onDownloadAll}
						/>
						{isPersonalOneDrive && (
							<p className='px-4 text-center text-12 leading-relaxed text-white/50'>
								<Trans
									t={t}
									i18nKey='files-cloud.folder-personal-vault-note'
									components={{
										personalVault: (
											<a
												href='https://support.microsoft.com/en-US/onedrive/protect-your-onedrive-files-in-personal-vault'
												target='_blank'
												rel='noopener noreferrer'
												className='underline decoration-white/30 underline-offset-2 transition-colors hover:text-white'
											/>
										),
									}}
								/>
							</p>
						)}
					</div>
				</div>
				<DialogFooter className='justify-center gap-2 pt-6'>
					<Button size='dialog' onClick={onBack}>
						{t('back')}
					</Button>
				</DialogFooter>
			</div>
		)
	}

	const body = (() => {
		if (state === 'busy') return t('files-cloud-error.account-busy')
		if (state === 'auth') return t('files-cloud.folder-auth-required')
		return t('files-cloud.folder-error')
	})()

	return (
		<div className='py-2'>
			<div className='flex flex-col items-center gap-4 py-6 text-center'>
				<CloudLinkDiagram layoutKey={layoutKey} logo={logo} morph={morph} />
				<div className='max-w-[340px]'>
					<p className='text-13 leading-relaxed text-white/60'>{body}</p>
					{state === 'error' && errorMessage && <p className='text-12 leading-relaxed text-white/40'>{errorMessage}</p>}
				</div>
			</div>
			<DialogFooter className='justify-center gap-2 pt-4'>
				{state === 'auth' ? (
					<Button variant='primary' size='dialog' onClick={onSignIn}>
						{t('files-cloud.folder-sign-in')}
					</Button>
				) : (
					<Button variant='primary' size='dialog' onClick={onRetry}>
						{t('try-again')}
					</Button>
				)}
				<Button size='dialog' onClick={onBack}>
					{t('back')}
				</Button>
			</DialogFooter>
		</div>
	)
}
