import Umbreld from '../../source/index.js'

const createUmbreld = async (dataDirectory, port = 0, logLevel = 'silent') => {
	const umbreld = new Umbreld({
		dataDirectory,
		port,
		logLevel,
	})
	await umbreld.start()

	return umbreld
}

export default createUmbreld
