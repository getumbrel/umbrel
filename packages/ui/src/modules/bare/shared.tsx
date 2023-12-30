import UmbrelLogo from '@/assets/umbrel-logo'
import {tw} from '@/utils/tw'

export const bareContainerClass = tw`mt-[10vh] flex-1 flex h-full max-w-full flex-col items-center sm:w-auto`
export const bareTitleClass = tw`sm:text-36 text-24 font-bold -tracking-2`
export const bareTextClass = tw`text-center text-15 font-medium leading-tight -tracking-2 text-white/80`

export const BareLogoTitle = ({children}: {children: React.ReactNode}) => (
	<div className='flex flex-col items-center gap-4'>
		<UmbrelLogo />
		<h1 className={bareTitleClass}>{children}</h1>
	</div>
)

export const BareSpacer = () => <div className='pt-[50px]' />
