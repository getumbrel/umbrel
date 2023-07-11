import express from 'express'
import pify from 'pify'

import isAuthenticated from './middleware/is-authenticated.js'

// A wrapper around the express router that provides a more convenient API
// with common footguns avoided and an easy way to interface with umbreld
// modules.
class Router {
	routes = new express.Router()

	constructor({logger}) {
		this.logger = logger

		// Create route handler methods
		const methods = ['get', 'post', 'delete', 'put']
		this.public = {}
		for (const method of methods) {
			this[method] = this.wrapMethod(method, {requiresAuthentication: true})
			this.public[method] = this.wrapMethod(method, {requiresAuthentication: false})
		}
	}

	wrapMethod(method, {requiresAuthentication = true} = {}) {
		return (...parameters) => {
			// Pull out the arguments
			const path = parameters.at(0)
			const umbrelHandler = parameters.at(-1)
			let middleware = parameters.slice(1, -1)

			// If we're adding auth add it before any other potential middleware
			if (requiresAuthentication) {
				middleware = [isAuthenticated, ...middleware]
			}

			// Wrap our custom handler signature in the express signature and
			// catch any rejected promises and pass them over to the registered
			// express error handling middleware
			const expressHandler = async (request, response, next) => {
				try {
					const umbreld = request.app.get('umbreld')
					const {logger} = this
					request.session = pify(request.session)
					return await umbrelHandler({
						request,
						response,
						next,
						umbreld,
						...umbreld.services,
						logger,
					})
				} catch (error) {
					return next(error)
				}
			}

			// Hand everything over to the express router
			return this.routes[method](path, ...middleware, expressHandler)
		}
	}
}

export default Router
