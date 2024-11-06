import {TbRotate2} from 'react-icons/tb'
import {Route, Routes, useNavigate} from 'react-router-dom'

import {ImmersiveDialog, ImmersiveDialogSplitContent} from '@/components/ui/immersive-dialog'
import {EnsureLoggedIn} from '@/modules/auth/ensure-logged-in'
import {useGlobalSystemState} from '@/providers/global-system-state'
import {RouterError} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

import {ConfirmWithPassword} from './_components/confirm-with-password'
import {backPath} from './_components/misc'
import {ReviewData} from './_components/review-data'
import {Success} from './_components/success'

export default function FactoryReset() {
	// TODO: if the route is `/failed` and we don't have a password, redirect to `/confirm`
	const {reset, getError, clearError} = useGlobalSystemState()

	const isPasswordError = (error: RouterError) => {
		return error?.data?.code === 'UNAUTHORIZED'
	}

	const getPasswordError = () => {
		const error = getError()
		return error && isPasswordError(error) ? error.message : ''
	}

	// Handling routes in this weird way because:
	// - Standard router approach won't work because `<Outlet />` is generic and we want this parent to have state
	// - We do want to load all the sub-routes anyways
	// - Not using data routers anyways, which is why we'd be putting things in `router.tsx` anyways
	// - Initial routes require a user to be logged in, but other subroutes don't
	// - Wanna keep the trpc mutation that starts the factory reset in the same component so errors are handled properly
	// - If we wanna restart the mutation, we don't wanna have the user put the password in again
	return (
		<>
			<Routes>
				<Route
					path='/'
					element={
						<EnsureLoggedIn>
							<SplitDialog>
								<ReviewData />
							</SplitDialog>
						</EnsureLoggedIn>
					}
				/>
				<Route
					path='/confirm'
					element={
						<EnsureLoggedIn>
							<SplitDialog>
								<ConfirmWithPassword onSubmit={reset} error={getPasswordError()} clearError={clearError} />
							</SplitDialog>
						</EnsureLoggedIn>
					}
				/>
				<Route path='/success' element={<Success />} />
			</Routes>
		</>
	)
}

function SplitDialog({children}: {children: React.ReactNode}) {
	const navigate = useNavigate()
	return (
		<ImmersiveDialog defaultOpen onOpenChange={(isOpen) => !isOpen && navigate(backPath, {preventScrollReset: true})}>
			<ImmersiveDialogSplitContent side={<SplitLeftContent />}>{children}</ImmersiveDialogSplitContent>
		</ImmersiveDialog>
	)
}

function SplitLeftContent() {
	return (
		<div className='flex flex-col items-center'>
			<div
				className='grid h-[67px] w-[67px] place-items-center rounded-15 bg-destructive2'
				style={{
					boxShadow: '0 1px 1px #ffffff33 inset',
				}}
			>
				<TbRotate2 className='h-[40px] w-[40px]' />
			</div>
			<div className='mt-2.5 px-2 text-center text-15 font-medium'>{t('factory-reset')}</div>
			<div className='text-13 opacity-40'>{t('umbrel')}</div>
		</div>
	)
}
