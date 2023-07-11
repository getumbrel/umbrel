import bcrypt from 'bcryptjs'

import {HttpError, validate} from '../middleware/error-handler.js'

export const register = async ({request, response, store}) => {
	validate(request.body, {
		username: validate.is.string,
		password: validate.is.string.minLength(6),
	})
	const {username, password} = request.body

	// Check the user hasn't already signed up
	const existingUser = await store.get('user')
	if (existingUser !== undefined) {
		throw new HttpError(401, 'Attempted to register when user is already registered')
	}

	// Hash the password with the current recommended default
	// of 10 bcrypt rounds
	// https://security.stackexchange.com/a/83382
	const saltRounds = 10
	const hashedPassword = await bcrypt.hash(password, saltRounds)

	// Save the user
	await store.set('user', {username, hashedPassword})

	response.json({success: true})
}

export const login = async ({request, response, store}) => {
	validate(request.body, {password: validate.is.string})
	const {password} = request.body

	// Grab local user info
	const user = await store.get('user')
	const hashedPassword = user?.hashedPassword || ''

	// Validate credentials
	const noUser = user === undefined
	const validPassword = await bcrypt.compare(password, hashedPassword)
	if (noUser || !validPassword) {
		throw new HttpError(401, 'Invalid login')
	}

	// Regenerate session ID immediately after auth for additional protection
	// against session fixation attacks
	// https://www.invicti.com/learn/session-fixation/
	await request.session.regenerate()

	// Store logged in status in session
	request.session.renewed = Date.now()

	// Wait for the session to be update before sending response
	// to ensure future requests are valid
	await request.session.save()

	response.json({success: true})
}

export const renewSession = ({request, response}) => {
	// Modify cookie to trigger an update
	request.session.renewed = Date.now()

	response.json({success: true})
}

export const logout = async ({request, response}) => {
	await request.session.destroy()

	response.json({success: true})
}

// TODO: 2FA
