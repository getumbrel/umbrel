import {Portal} from '@radix-ui/react-portal'
import {ReactNode} from 'react'

const SHEET_FIXED_ID = 'sheet-fixed-id'

export function SheetFixedTarget() {
	return <div id={SHEET_FIXED_ID} />
}
export function SheetFixedContent({children}: {children: ReactNode}) {
	return <Portal container={document.getElementById(SHEET_FIXED_ID)}>{children}</Portal>
}
