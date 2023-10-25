import {copyFile, existsSync, mkdirSync, readdir} from 'fs'
import {join} from 'path'

const sourceFolder = './node_modules/@tabler/icons/icons'
const destinationFolder = './public/generated-tabler-icons'

if (!existsSync(destinationFolder)) {
	mkdirSync(destinationFolder, {recursive: true})
}

readdir(sourceFolder, (err, files) => {
	if (err) throw err

	files.forEach((file) => {
		const sourceFilePath = join(sourceFolder, file)
		const destinationFilePath = join(destinationFolder, file)

		copyFile(sourceFilePath, destinationFilePath, (err) => {
			if (err) throw err
		})
	})
})
