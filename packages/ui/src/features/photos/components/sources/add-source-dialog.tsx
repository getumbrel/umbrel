import {AnimatePresence, motion, useReducedMotion} from 'motion/react'
import {useEffect, useState, type ReactNode} from 'react'
import {useTranslation} from 'react-i18next'
import {useNavigate} from 'react-router-dom'

import {AnimatedHeight} from '@/components/ui/animated-height'
import {Button} from '@/components/ui/button'
import {
	Dialog,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogScrollableContent,
	DialogTitle,
} from '@/components/ui/dialog'
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
import {ChoiceCard} from '@/features/photos/components/sources/choice-card'
import {SourceIcon} from '@/features/photos/components/sources/source-icon'
import {UmbrelScopeSettings} from '@/features/photos/components/sources/source-settings'
import {sourcePath} from '@/features/photos/constants'
import {usePhotoSourceActions, usePhotoSources, type SourceSettings} from '@/features/photos/hooks/use-photo-sources'
import {useIsPhone} from '@/hooks/use-is-mobile'
import {useDialogOpenProps} from '@/utils/dialog'

type Step = 'kind' | 'umbrel'

// Where photos come from. Phones register themselves from the Umbrel app, so
// those cards only hand over to it; This Umbrel is a permanent source, so its
// card shows the live import scope (all folders / except / only) and saves
// changes to it. Drives and NAS are post-v1: their cards stay visible but
// locked, so the roadmap reads at a glance.
export function AddSourceDialog() {
	const homePath = useHomePath()
	const dialogProps = useDialogOpenProps('photos-add-source')
	const {t} = useTranslation()
	const isPhone = useIsPhone()
	const navigate = useNavigate()
	const {updateSettings} = usePhotoSourceActions()
	// This Umbrel is a permanent source; its card opens that source's scope
	const {sources} = usePhotoSources()
	const umbrelSource = sources.find((source) => source.type === 'umbrel')

	const [step, setStep] = useState<Step>('kind')
	const [umbrelScope, setUmbrelScope] = useState<SourceSettings['scope']>({mode: 'everything', paths: []})

	// Fresh wizard every time it opens
	useEffect(() => {
		if (!dialogProps.open) return
		setStep('kind')
	}, [dialogProps.open])

	const handleSaveUmbrel = async () => {
		if (!umbrelSource) return
		try {
			await updateSettings({id: umbrelSource.id, settings: {scope: umbrelScope}})
			dialogProps.onOpenChange(false)
			navigate(sourcePath(umbrelSource.id))
		} catch {
			toast.error(t('photos-selection.failed'), {area: 'photos'})
		}
	}

	const titles: Record<Step, {title: string; description?: string}> = {
		kind: {title: t('photos-add-source.title'), description: t('photos-add-source.description')},
		umbrel: {title: t('photos-add-source.kind-folder'), description: t('photos-add-source.umbrel-description')},
	}
	const {title, description} = titles[step]

	const reducedMotion = useReducedMotion() ?? false
	const stepFade = {
		initial: {opacity: 0},
		animate: {opacity: 1},
		exit: {opacity: 0},
		transition: {duration: reducedMotion ? 0 : 0.18},
	}

	// The ways in today first; the locked kinds stay visible so the roadmap
	// reads at a glance
	const kindCards: {
		id: string
		art: ReactNode
		title: string
		description: string
		locked?: boolean
		open?: () => void
	}[] = [
		{
			id: 'iphone',
			art: <SourceIcon type='iphone' size={40} />,
			title: t('photos-add-source.kind-iphone'),
			description: t('photos-add-source.kind-iphone-description'),
			// The Umbrel app carries the whole flow; the phone cards just hand over to it
			open: () => window.open('https://link.umbrel.com/ios-app', '_blank', 'noopener,noreferrer'),
		},
		{
			id: 'android',
			art: <SourceIcon type='android' size={40} />,
			title: t('photos-add-source.kind-android'),
			description: t('photos-add-source.kind-android-description'),
			open: () => window.open('https://link.umbrel.com/android-app', '_blank', 'noopener,noreferrer'),
		},
		{
			id: 'folder',
			art: <SourceIcon type='umbrel' size={40} />,
			title: t('photos-add-source.kind-folder'),
			description: t('photos-add-source.kind-folder-description'),
			// This Umbrel is a permanent source: its card opens with the live
			// scope — the status of where Photos imports from today
			open: () => {
				setUmbrelScope(umbrelSource?.scope ?? {mode: 'everything', paths: []})
				setStep('umbrel')
			},
		},
		{
			id: 'external-drive',
			art: <SourceIcon type='external-drive' size={40} />,
			title: t('photos-add-source.kind-drive'),
			description: t('photos-add-source.kind-drive-description'),
			locked: true,
		},
		{
			id: 'network-share',
			art: <SourceIcon type='network-share' size={40} />,
			title: t('photos-add-source.kind-nas'),
			description: t('photos-add-source.kind-nas-description'),
			locked: true,
		},
	]

	// An except/only choice with nothing picked would import everything/nothing
	const scopeNeedsFolders = umbrelScope.mode !== 'everything' && umbrelScope.paths.length === 0

	const body = (
		<div className='overflow-x-hidden'>
			<AnimatedHeight transition={{type: 'spring', stiffness: 300, damping: 34}} contentClassName='relative'>
				<AnimatePresence mode='popLayout' initial={false}>
					{step === 'kind' && (
						<motion.div key='kind' {...stepFade} className='flex flex-col gap-2 py-2'>
							{kindCards.map((card) => (
								<ChoiceCard
									key={card.id}
									art={card.art}
									selected={false}
									title={card.title}
									description={card.description}
									disabled={card.locked}
									badge={card.locked ? t('photos-add-source.coming-soon') : undefined}
									chevron={!card.locked}
									onClick={() => card.open?.()}
								/>
							))}
						</motion.div>
					)}

					{step === 'umbrel' && (
						<motion.div key='umbrel' {...stepFade} className='flex flex-col gap-4 py-2'>
							<UmbrelScopeSettings rootPath={homePath} scope={umbrelScope} onChange={setUmbrelScope} />
							<DialogFooter className='gap-2 pt-2'>
								<Button
									variant='primary'
									size='dialog'
									onClick={handleSaveUmbrel}
									disabled={!umbrelSource || scopeNeedsFolders}
								>
									{t('photos-add-source.save')}
								</Button>
								<Button size='dialog' onClick={() => setStep('kind')}>
									{t('back')}
								</Button>
							</DialogFooter>
						</motion.div>
					)}
				</AnimatePresence>
			</AnimatedHeight>
		</div>
	)

	const header = isPhone ? (
		<DrawerHeader>
			<DrawerTitle>{title}</DrawerTitle>
			{description ? <DrawerDescription>{description}</DrawerDescription> : null}
		</DrawerHeader>
	) : (
		<DialogHeader>
			<DialogTitle>{title}</DialogTitle>
			{description ? <DialogDescription>{description}</DialogDescription> : null}
		</DialogHeader>
	)

	return isPhone ? (
		<Drawer open={dialogProps.open} onOpenChange={dialogProps.onOpenChange}>
			<DrawerContent fullHeight>
				{header}
				<DrawerScroller>{body}</DrawerScroller>
			</DrawerContent>
		</Drawer>
	) : (
		<Dialog open={dialogProps.open} onOpenChange={dialogProps.onOpenChange}>
			<DialogScrollableContent>
				<div className='flex flex-col gap-5 px-5 py-6'>
					{header}
					{body}
				</div>
			</DialogScrollableContent>
		</Dialog>
	)
}
