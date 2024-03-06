import {UmbrelHeadTitle} from '@/components/umbrel-head-title'
import {useUserName} from '@/hooks/use-user-name'
import {useSettingsDialogProps} from '@/routes/settings/_components/shared'
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
import {t} from '@/utils/i18n'

export default function ChangeNameDialog() {
	const title = t('change-name')
	const dialogProps = useSettingsDialogProps()

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
								<UmbrelHeadTitle>{title}</UmbrelHeadTitle>
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
