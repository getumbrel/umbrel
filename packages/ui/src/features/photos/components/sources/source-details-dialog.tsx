import {useTranslation} from 'react-i18next'

import {AnimatedHeight} from '@/components/ui/animated-height'
import {Dialog, DialogDescription, DialogHeader, DialogScrollableContent, DialogTitle} from '@/components/ui/dialog'
import {
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerHeader,
	DrawerScroller,
	DrawerTitle,
} from '@/components/ui/drawer'
import {toast} from '@/components/ui/toast'
import {useHomePath} from '@/features/files/hooks/use-home-path'
import {PhoneSourceName} from '@/features/photos/components/sources/phone-source-name'
import {SourceIcon} from '@/features/photos/components/sources/source-icon'
import {PushSourceSettings, UmbrelScopeSettings} from '@/features/photos/components/sources/source-settings'
import {sourceTypeLabel, timeAgo} from '@/features/photos/components/sources/source-status'
import {usePhotoSource, usePhotoSourceActions, type PhotoSource} from '@/features/photos/hooks/use-photo-sources'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {useQueryParams} from '@/hooks/use-query-params'
import {useDialogOpenProps} from '@/utils/dialog'
import {formatNumberI18n} from '@/utils/number'

// Everything about one source, opened from its sidebar "⋯", its context menu,
// the overview tiles, or the source page's Manage button. One card of facts
// led by who it is, then its settings. (The link diagram, import progress and
// state banners return with the post-v1 source types.)
export function SourceDetailsDialog() {
	const dialogProps = useDialogOpenProps('photos-source')
	const {params} = useQueryParams()
	const sourceId = params.get('photos-source-id') ?? undefined
	const {source} = usePhotoSource(sourceId)
	const isMobile = useIsMobile()
	const {t} = useTranslation()

	if (!source) return null

	const body = <SourceDetailsBody key={source.id} source={source} />

	// The identity block carries the visible title; the structural title and
	// description stay for screen readers only
	if (isMobile) {
		return (
			<Drawer open={dialogProps.open} onOpenChange={dialogProps.onOpenChange}>
				<DrawerContent fullHeight>
					<DrawerHeader className='sr-only'>
						<DrawerTitle>{source.name}</DrawerTitle>
						<DrawerDescription>{sourceTypeLabel(source.type, t)}</DrawerDescription>
					</DrawerHeader>
					<DrawerScroller>{body}</DrawerScroller>
				</DrawerContent>
			</Drawer>
		)
	}

	return (
		<Dialog open={dialogProps.open} onOpenChange={dialogProps.onOpenChange}>
			{/* Same scrolling shell and close button as the Settings dialogs. Focus
			    isn't handed back to the opener on close — the browser would paint
			    its focus ring on a button that was only ever clicked */}
			<DialogScrollableContent
				showClose
				onOpenAutoFocus={(e) => e.preventDefault()}
				onCloseAutoFocus={(e) => e.preventDefault()}
			>
				<DialogHeader className='sr-only'>
					<DialogTitle>{source.name}</DialogTitle>
					<DialogDescription>{sourceTypeLabel(source.type, t)}</DialogDescription>
				</DialogHeader>
				{/* The scope picker grows and shrinks the body (its folder list comes
				    and goes); the dialog rides the change the way the add dialog does */}
				<div className='px-5 py-6'>
					<AnimatedHeight transition={{type: 'spring', stiffness: 300, damping: 34}}>{body}</AnimatedHeight>
				</div>
			</DialogScrollableContent>
		</Dialog>
	)
}

function SourceDetailsBody({source}: {source: PhotoSource}) {
	const homePath = useHomePath()
	const {t, i18n} = useTranslation()
	const {updateSettings} = usePhotoSourceActions()
	// Phones keep their backup settings in the app; only their Photos display
	// name is editable here.
	const isUmbrel = source.type === 'umbrel'

	const number = (n: number) => formatNumberI18n({n, showDecimals: false, locale: i18n.language})

	return (
		<div className='flex flex-col gap-4'>
			{isUmbrel ? (
				<div className='flex flex-col items-center gap-3 pt-2 pb-1 text-center'>
					<SourceIcon type='umbrel' size={64} />
					<div>
						<p className='text-15 font-semibold -tracking-2'>{source.name}</p>
						<p className='mx-auto mt-1 max-w-[320px] text-12 leading-relaxed text-white/50'>
							{t('photos-add-source.kind-folder-description')}
						</p>
					</div>
				</div>
			) : (
				<div className='flex flex-col items-center gap-3 pt-2 pb-1 text-center'>
					<SourceIcon type={source.type} size={64} />
					<div className='w-full min-w-0'>
						<PhoneSourceName source={source} />
						<p className='mt-1 text-12 text-white/50'>
							{t('photos-source.fact-items-value', {
								photos: number(source.stats.photos),
								videos: number(source.stats.videos),
							})}
						</p>
						{source.lastImportAt && (
							<p className='mt-0.5 text-12 text-white/35'>
								{t('photos-source.last-backup', {ago: timeAgo(source.lastImportAt, i18n.language)})}
							</p>
						)}
					</div>
				</div>
			)}

			{/* Settings. This Umbrel gets the same big scope picker as the add
			    dialog, saving as it changes. */}
			{isUmbrel && source.scope ? (
				<UmbrelScopeSettings
					rootPath={homePath}
					scope={source.scope}
					onChange={(scope) =>
						updateSettings({id: source.id, settings: {scope}}).catch(() =>
							toast.error(t('photos-selection.failed'), {area: 'photos'}),
						)
					}
				/>
			) : (
				<PushSourceSettings />
			)}
		</div>
	)
}
