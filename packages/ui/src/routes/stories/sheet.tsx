import {Wallpaper} from '@/modules/desktop/wallpaper-context'
import {Sheet, SheetContent} from '@/shadcn-components/ui/sheet'

export function SheetStory() {
	return (
		<>
			<Wallpaper />
			<Sheet defaultOpen>
				<SheetContent className='mx-auto h-[calc(100dvh-16px)] max-w-[1320px] pb-6 lg:h-[calc(100dvh-60px)] lg:w-[calc(100vw-60px-60px)]'>
					<div className='umbrel-dialog-fade-scroller flex h-full flex-col gap-5 overflow-y-auto pt-12 md:px-8'>
						Hello
					</div>
				</SheetContent>
			</Sheet>
		</>
	)
}
