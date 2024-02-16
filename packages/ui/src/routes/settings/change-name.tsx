import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {useUserName} from '@/hooks/use-user-name'
import {Button} from '@/shadcn-components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogPortal,
	DialogTitle,
} from '@/shadcn-components/ui/dialog'
import {AnimatedInputError, Input} from '@/shadcn-components/ui/input'
import {useDialogOpenProps} from '@/utils/dialog'
import {t} from '@/utils/i18n'

export default function ChangeNameDialog() {
	const title = t('change-name')
	useUmbrelTitle(title)
	const dialogProps = useDialogOpenProps('change-name')

	const {name, setName, handleSubmit, formError, isLoading} = useUserName({
		onSuccess: () => dialogProps.onOpenChange(false),
	})

	return (
		<Dialog {...dialogProps}>
			<DialogPortal>
				<DialogContent asChild>
					<form onSubmit={handleSubmit}>
						<fieldset disabled={isLoading} className='flex flex-col gap-5'>
							<DialogHeader>
								<DialogTitle>{title}</DialogTitle>
								<DialogDescription>{t('change-name.description')}</DialogDescription>
							</DialogHeader>
							<Input placeholder={t('change-name.input-placeholder')} value={name} onValueChange={setName} />
							<div className='-my-2.5'>
								<AnimatedInputError>{formError}</AnimatedInputError>
							</div>
							<DialogFooter>
								<Button type='submit' size='dialog' variant='primary'>
									{t('save-changes')}
								</Button>
								<Button type='button' size='dialog' onClick={() => dialogProps.onOpenChange(false)}>
									{t('cancel')}
								</Button>
							</DialogFooter>
						</fieldset>
					</form>
				</DialogContent>
			</DialogPortal>
		</Dialog>
	)
}
