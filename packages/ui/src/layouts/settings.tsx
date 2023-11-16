import {Suspense} from 'react'
import {useTranslation} from 'react-i18next'
import {Outlet} from 'react-router-dom'

import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {SheetHeader, SheetTitle} from '@/shadcn-components/ui/sheet'

import {SettingsContent} from '../routes/settings/_components/settings-content'

export function SettingsLayout() {
	const {t} = useTranslation()
	useUmbrelTitle(t('settings'))

	return (
		<>
			<SheetHeader>
				<SheetTitle className='text-48 leading-none'>{t('settings')}</SheetTitle>
			</SheetHeader>
			<SettingsContent />
			{/* TODO: don't show children until after settings dialog is done animating in. Maybe use framer-motion animation staggering */}
			<Suspense>
				<Outlet />
			</Suspense>
		</>
	)
}
