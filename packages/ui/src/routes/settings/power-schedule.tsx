import {useEffect, useMemo, useState} from 'react'
import {useTranslation} from 'react-i18next'

import {Button} from '@/components/ui/button'
import {Dialog, DialogHeader, DialogScrollableContent, DialogTitle} from '@/components/ui/dialog'
import {Drawer, DrawerContent, DrawerHeader, DrawerScroller, DrawerTitle} from '@/components/ui/drawer'
import {Input} from '@/components/ui/input'
import {Switch} from '@/components/ui/switch'
import {toast} from '@/components/ui/toast'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {useSettingsDialogProps} from '@/routes/settings/_components/shared'
import {RouterInput, trpcReact} from '@/trpc/trpc'
import {cn} from '@/lib/utils'

const DEFAULT_TIME = '00:00'

type PowerScheduleInput = RouterInput['system']['setPowerSchedule']

export default function PowerScheduleDialog() {
	const {t} = useTranslation()
	const dialogProps = useSettingsDialogProps()
	const isMobile = useIsMobile()

	const scheduleQ = trpcReact.system.getPowerSchedule.useQuery()
	const updateScheduleMut = trpcReact.system.setPowerSchedule.useMutation({
		onSuccess: () => scheduleQ.refetch(),
		onError: (error) => toast.error(error.message),
	})

	const [shutdownEnabled, setShutdownEnabled] = useState(false)
	const [shutdownTime, setShutdownTime] = useState(DEFAULT_TIME)
	const [restartEnabled, setRestartEnabled] = useState(false)
	const [restartTime, setRestartTime] = useState(DEFAULT_TIME)

	useEffect(() => {
		if (!scheduleQ.data) return
		setShutdownEnabled(scheduleQ.data.shutdown.enabled)
		setShutdownTime(scheduleQ.data.shutdown.time || DEFAULT_TIME)
		setRestartEnabled(scheduleQ.data.restart.enabled)
		setRestartTime(scheduleQ.data.restart.time || DEFAULT_TIME)
	}, [scheduleQ.data])

	const scheduleInput = useMemo<PowerScheduleInput>(
		() => ({
			shutdown: {enabled: shutdownEnabled, time: shutdownTime},
			restart: {enabled: restartEnabled, time: restartTime},
		}),
		[shutdownEnabled, shutdownTime, restartEnabled, restartTime],
	)

	const isDirty = useMemo(() => {
		if (!scheduleQ.data) return false
		return (
			scheduleQ.data.shutdown.enabled !== shutdownEnabled ||
			scheduleQ.data.shutdown.time !== shutdownTime ||
			scheduleQ.data.restart.enabled !== restartEnabled ||
			scheduleQ.data.restart.time !== restartTime
		)
	}, [restartEnabled, restartTime, scheduleQ.data, shutdownEnabled, shutdownTime])

	const isLoading = scheduleQ.isLoading || updateScheduleMut.isPending

	const handleSave = () => {
		updateScheduleMut.mutate(scheduleInput)
	}

	const content = (
		<div className='space-y-6'>
			<div className='space-y-1'>
				<p className='text-13 text-white/50'>{t('power-schedule.subtitle')}</p>
				<p className='text-13 text-white/40'>{t('power-schedule.note')}</p>
			</div>
			<div className='space-y-4'>
				<ScheduleRow
					title={t('power-schedule.shutdown.title')}
					description={t('power-schedule.shutdown.description')}
					enabled={shutdownEnabled}
					onEnabledChange={setShutdownEnabled}
					time={shutdownTime}
					onTimeChange={setShutdownTime}
					disabled={isLoading}
				/>
				<ScheduleRow
					title={t('power-schedule.restart.title')}
					description={t('power-schedule.restart.description')}
					enabled={restartEnabled}
					onEnabledChange={setRestartEnabled}
					time={restartTime}
					onTimeChange={setRestartTime}
					disabled={isLoading}
				/>
			</div>
			<div className='flex flex-col gap-2 md:flex-row md:justify-end'>
				<Button size='dialog' variant='primary' onClick={handleSave} disabled={!isDirty || isLoading}>
					{t('save')}
				</Button>
				<Button size='dialog' onClick={() => dialogProps.onOpenChange(false)} disabled={isLoading}>
					{t('cancel')}
				</Button>
			</div>
		</div>
	)

	if (isMobile) {
		return (
			<Drawer {...dialogProps}>
				<DrawerContent fullHeight>
					<DrawerHeader>
						<DrawerTitle>{t('power-schedule.title')}</DrawerTitle>
					</DrawerHeader>
					<DrawerScroller>
						<div className='space-y-6 px-5 pb-6'>{content}</div>
					</DrawerScroller>
				</DrawerContent>
			</Drawer>
		)
	}

	return (
		<Dialog {...dialogProps}>
			<DialogScrollableContent>
				<div className='space-y-6 px-5 py-6'>
					<DialogHeader>
						<DialogTitle>{t('power-schedule.title')}</DialogTitle>
					</DialogHeader>
					{content}
				</div>
			</DialogScrollableContent>
		</Dialog>
	)
}

function ScheduleRow({
	title,
	description,
	enabled,
	onEnabledChange,
	time,
	onTimeChange,
	disabled,
}: {
	title: string
	description: string
	enabled: boolean
	onEnabledChange: (value: boolean) => void
	time: string
	onTimeChange: (value: string) => void
	disabled: boolean
}) {
	return (
		<div className='flex flex-col gap-3 rounded-12 bg-white/6 p-4'>
			<div className='flex items-center justify-between gap-4'>
				<div>
					<h3 className='text-14 font-medium'>{title}</h3>
					<p className='text-13 text-white/40'>{description}</p>
				</div>
				<Switch checked={enabled} onCheckedChange={onEnabledChange} disabled={disabled} />
			</div>
			<div className='flex items-center gap-3'>
				<Input
					type='time'
					value={time}
					onValueChange={(value) => onTimeChange(value)}
					sizeVariant='short'
					disabled={!enabled || disabled}
					className={cn('w-[140px] text-white', !enabled && 'opacity-50')}
				/>
				<span className='text-13 text-white/40'>{enabled ? time : '--:--'}</span>
			</div>
		</div>
	)
}
