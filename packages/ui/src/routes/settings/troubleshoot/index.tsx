import {DialogPortal} from '@radix-ui/react-dialog'
import {DropdownMenu} from '@radix-ui/react-dropdown-menu'
import {t} from 'i18next'
import {Suspense, useState} from 'react'
import {Route, Routes, useNavigate, useParams} from 'react-router-dom'

import {
	ImmersiveDialog,
	ImmersiveDialogContent,
	ImmersiveDialogOverlay,
	immersiveDialogTitleClass,
} from '@/components/ui/immersive-dialog'
import {useSettingsDialogProps} from '@/routes/settings/_components/shared'
import {TroubleshootDropdown} from '@/routes/settings/troubleshoot/_shared'
import {TroubleshootApp} from '@/routes/settings/troubleshoot/app'
import TroubleshootUmbrelOs from '@/routes/settings/troubleshoot/umbrelos'
import {cn} from '@/shadcn-lib/utils'
import {tw} from '@/utils/tw'

export default function TroubleshootDialog() {
	const dialogProps = useSettingsDialogProps()

	return (
		<ImmersiveDialog {...dialogProps}>
			<DialogPortal>
				<ImmersiveDialogOverlay />
				<Suspense>
					<Routes>
						<Route index path='/' element={<PickerDialogContent />} />
						<Route
							path='/umbrelos/:systemTab?'
							element={
								<ImmersiveDialogContent>
									<div className={troubleshootContentLayoutClass}>
										<TroubleshootUmbrelOs />
									</div>
								</ImmersiveDialogContent>
							}
						/>
						<Route
							path='/app/:appId'
							element={
								<ImmersiveDialogContent>
									<div className={troubleshootContentLayoutClass}>
										<TroubleshootApp />
									</div>
								</ImmersiveDialogContent>
							}
						/>
					</Routes>
				</Suspense>
			</DialogPortal>
		</ImmersiveDialog>
	)
}

export const troubleshootContentLayoutClass = tw`flex max-h-full flex-1 flex-col items-start gap-4`

function PickerDialogContent() {
	const navigate = useNavigate()
	const [appDialogOpen, setAppDialogOpen] = useState(false)
	const params = useParams<{appId: string}>()

	return (
		<ImmersiveDialogContent short>
			<h1 className={cn(immersiveDialogTitleClass, '-mt-1 text-19')}>{t('troubleshoot-pick-title')}</h1>
			<div className='flex flex-col gap-2.5'>
				<button className={radioButtonClass} onClick={() => navigate('/settings/troubleshoot/umbrelos/umbrelos')}>
					<div>
						<div className={radioTitleClass}>{t('umbrelos')}</div>
						<div className={radioDescriptionClass}>{t('troubleshoot.umbrelos-description')}</div>
					</div>
				</button>
				<button className={radioButtonClass} onClick={() => setAppDialogOpen(true)}>
					<div>
						<div className={radioTitleClass}>{t('troubleshoot.app')}</div>
						<div className={radioDescriptionClass}>{t('troubleshoot.app-description')}</div>
					</div>
					<DropdownMenu open={appDialogOpen} onOpenChange={setAppDialogOpen}>
						<TroubleshootDropdown
							open={appDialogOpen}
							onOpenChange={setAppDialogOpen}
							appId={params.appId}
							setAppId={(appId) => navigate(`/settings/troubleshoot/app/${appId}`)}
						/>
					</DropdownMenu>
				</button>
			</div>
		</ImmersiveDialogContent>
	)
}

const radioButtonClass = tw`rounded-12 bg-white/5 p-5 text-left flex justify-between items-center gap-2 flex-wrap shadow-button-highlight-soft-hpx outline-none duration-300 hover:bg-white/6 transition-[background,color,box-shadow] focus-visible:ring-4 ring-white/5 focus-visible:ring-offset-1 ring-offset-white/20`
const radioTitleClass = tw`text-15 font-medium -tracking-2`
const radioDescriptionClass = tw`text-13 opacity-90 -tracking-2`
