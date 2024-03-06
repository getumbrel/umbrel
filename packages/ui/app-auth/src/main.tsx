import React from 'react'
import {BrowserRouter} from 'react-router-dom'

import {init} from '../../src/init'
import LoginWithUmbrel from '../../src/routes/login-with-umbrel'

init(
	<BrowserRouter>
		<LoginWithUmbrel />
	</BrowserRouter>,
)
