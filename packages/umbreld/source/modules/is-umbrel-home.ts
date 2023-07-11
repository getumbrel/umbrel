import fse from 'fs-extra'
import systeminfo from 'systeminformation'

export default async function isUmbrelHome() {
	// This file exists in old versions of amd64 Umbrel OS builds due to the Docker build system.
	// It confuses the systeminfo library and makes it return the model as 'Docker Container'.
	await fse.remove('/.dockerenv')

	const {manufacturer, model} = await systeminfo.system()

	return manufacturer === 'Umbrel, Inc.' && model === 'Umbrel Home'
}
