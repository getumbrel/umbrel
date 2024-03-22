import {useState} from 'react'
import {TbRotate2} from 'react-icons/tb'
import {Route, Routes, useNavigate} from 'react-router-dom'
import {toast} from 'sonner'

import {ImmersiveDialog, ImmersiveDialogSplitContent} from '@/components/ui/immersive-dialog'
import {EnsureLoggedIn} from '@/modules/auth/ensure-logged-in'
import {trpcReact} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

import {ConfirmWithPassword} from './_components/confirm-with-password'
import {Failed} from './_components/failed'
import {backPath} from './_components/misc'
import {Resetting} from './_components/resetting'
import {ReviewData} from './_components/review-data'
import {Success} from './_components/success'

export default function FactoryReset() {
	// TODO: if the route is `/failed` and we don't have a password, redirect to `/confirm`
	const [password, setPassword] = useState('')

	const factoryResetMut = trpcReact.system.factoryReset.useMutation({
		onError: (err) => {
			if (err.data?.code === 'UNAUTHORIZED') {
				setPassword('')
			} else {
				toast.error(err.message)
			}
		},
	})

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
								<ConfirmWithPassword password={password} onPasswordChange={setPassword} mut={factoryResetMut} />
							</SplitDialog>
						</EnsureLoggedIn>
					}
				/>
				<Route path='/resetting' element={<Resetting />} />
				<Route path='/success' element={<Success />} />
				<Route path='/failed' element={<Failed />} />
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
