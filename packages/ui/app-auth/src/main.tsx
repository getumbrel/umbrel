import {BrowserRouter} from 'react-router-dom'

import {init} from '../../src/init'
import LoginWithUmbrel from './login-with-umbrel'

init(
	// NOTE: not putting `GlobalSystemStateProvider` here because we don't care.
	// It doesn't matter for the auth page
	<BrowserRouter>
		<LoginWithUmbrel />
	</BrowserRouter>,
)
