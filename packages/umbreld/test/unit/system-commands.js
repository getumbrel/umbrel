import test from 'ava'

import * as systemCommands from '../../source/utilities/system-commands.js'

test('systemCommands.shutdown can shut down the system', async (t) => {
	await systemCommands.shutdown()
	t.pass()
})

test('systemCommands.restart can restart the system', async (t) => {
	await systemCommands.restart()
	t.pass()
})

// TODO: test error throwing
