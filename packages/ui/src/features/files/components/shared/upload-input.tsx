import {forwardRef} from 'react'

import {useNavigate} from '@/features/files/hooks/use-navigate'
import {useGlobalFiles} from '@/providers/global-files'

export const UploadInput = forwardRef<HTMLInputElement>((_, ref) => {
	const {startUpload} = useGlobalFiles()
	const {currentPath} = useNavigate()

	const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		if (e.target.files && e.target.files.length > 0) {
			startUpload(e.target.files, currentPath)
			e.target.value = ''
		}
	}
	return <input type='file' ref={ref} style={{display: 'none'}} multiple accept='*' onChange={handleFileChange} />
})
