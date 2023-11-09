import {useState} from 'react'
import {useNavigate} from 'react-router-dom'
import {toast} from 'sonner'

import {DialogMounter} from '@/components/dialog-mounter'
import {PinInput} from '@/components/ui/pin-input'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {Dialog, DialogContent, DialogHeader, DialogPortal, DialogTitle} from '@/shadcn-components/ui/dialog'
import {Separator} from '@/shadcn-components/ui/separator'
import {trpcReact} from '@/trpc/trpc'
import {useAfterDelayedClose} from '@/utils/dialog'

export function TwoFactorDisableDialog() {
	const title = 'Disable two-factor authentication'
	useUmbrelTitle(title)
	const [open, setOpen] = useState(true)
	const navigate = useNavigate()

	useAfterDelayedClose(open, () => navigate('/settings', {preventScrollReset: true}))

	const ctx = trpcReact.useContext()
	const disable2faMut = trpcReact.user.disable2fa.useMutation()

	const checkCode = async (totpToken: string) => {
		return disable2faMut.mutateAsync(
			{totpToken},
			{
				onSuccess: () => {
					setTimeout(() => {
						ctx.user.is2faEnabled.invalidate()
						toast.success('Two-factor authentication disabled')
						setOpen(false)
					}, 500)
				},
			},
		)
	}

	return (
		<DialogMounter>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogPortal>
					<DialogContent className='flex flex-col items-center gap-5'>
						<DialogHeader>
							<DialogTitle>{title}</DialogTitle>
						</DialogHeader>
						<Separator />
						<p className='text-17 font-normal leading-none -tracking-2'>
							Enter the code displayed in your authenticator app
						</p>

						<PinInput autoFocus length={6} onCodeCheck={checkCode} />
					</DialogContent>
				</DialogPortal>
			</Dialog>
		</DialogMounter>
	)
}
