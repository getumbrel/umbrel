import {motion} from 'framer-motion'
import {useState} from 'react'
import {MdContentCopy} from 'react-icons/md'
import QRCode from 'react-qr-code'
import {useNavigate} from 'react-router-dom'
import {useCopyToClipboard} from 'react-use'

import {useAfterDelayedClose} from '@/components/client-layout'
import {DialogMounter} from '@/components/dialog-mounter'
import {PinInput} from '@/components/ui/pin-input'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogPortal,
	DialogTitle,
} from '@/shadcn-components/ui/dialog'
import {Separator} from '@/shadcn-components/ui/separator'
import {Tooltip, TooltipContent, TooltipTrigger} from '@/shadcn-components/ui/tooltip'
import {sleep} from '@/utils/misc'

export function TwoFactorDialog() {
	const title = 'Enable two-factor authentication'
	useUmbrelTitle(title)
	const [open, setOpen] = useState(true)
	const navigate = useNavigate()

	useAfterDelayedClose(open, () => navigate('/settings', {preventScrollReset: true}))

	const [, copyToClipboard] = useCopyToClipboard()
	const [showCopied, setShowCopied] = useState(false)

	const code = '4d33838f0a3f76510d8f24e259c5c3da8c4e245bd468afdd0eabfe86a4f7813e'

	return (
		<DialogMounter>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogPortal>
					<DialogContent className='flex flex-col items-center gap-5'>
						<DialogHeader>
							<DialogTitle>{title}</DialogTitle>
							<DialogDescription>
								Scan this QR code using an authenticator app like Google Authenticator or Authy
							</DialogDescription>
						</DialogHeader>
						<div
							className='relative mx-auto w-[240px]'
							style={{
								perspective: '300px',
							}}
						>
							<motion.div
								className='rounded-8 bg-white p-3'
								initial={{
									opacity: 0,
									rotateX: 20,
									rotateY: 10,
									rotateZ: 0,
									scale: 0.5,
								}}
								animate={{
									opacity: 1,
									rotateX: 0,
									rotateY: 0,
									rotateZ: 0,
									scale: 1,
								}}
								transition={{duration: 0.15, ease: 'easeOut'}}
							>
								<QRCode
									size={256}
									style={{height: 'auto', maxWidth: '100%', width: '100%'}}
									value={code}
									viewBox={`0 0 256 256`}
								/>
							</motion.div>
						</div>
						<div className='flex w-full flex-col items-center gap-2'>
							<p className='text-15 font-normal -tracking-2 opacity-60'>Or paste the following code in the app</p>
							<div className='flex max-w-full items-center gap-2 overflow-hidden rounded-4 border border-dashed border-white/5 bg-white/4 px-2.5 py-1.5 text-14 leading-none text-white/40 outline-none focus-visible:border-white/40'>
								<code className='block truncate'>{code}</code>
								<Tooltip open={showCopied}>
									<TooltipTrigger asChild>
										<button
											className='transition-colors hover:text-white/50'
											onClick={async () => {
												copyToClipboard(code)
												setShowCopied(true)
												await sleep(1000)
												setShowCopied(false)
											}}
										>
											<MdContentCopy className='shrink-0' />
										</button>
									</TooltipTrigger>
									<TooltipContent>Copied</TooltipContent>
								</Tooltip>
							</div>
						</div>
						<Separator />
						<p className='text-17 font-normal leading-none -tracking-2'>
							Enter the code displayed in your authenticator app
						</p>
						<PinInput autoFocus expected={'123123'} onSuccess={() => setOpen(false)} />
					</DialogContent>
				</DialogPortal>
			</Dialog>
		</DialogMounter>
	)
}
