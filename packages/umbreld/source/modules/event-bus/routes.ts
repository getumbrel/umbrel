import z from 'zod'
import {cloneDeep} from 'es-toolkit'

import {router, privateProcedure} from '../server/trpc/trpc.js'

import {type EventTypes, events} from './event-bus.js'

export default router({
	// Listen for events
	listen: privateProcedure
		.input(
			z.object({
				event: z.enum(events),
			}),
		)
		.subscription(async function* ({ctx, input, signal}) {
			// Stream the events
			// We pass in the AbortSignal so the stream can be immediately cleaned up
			// when the client disconnects to avoid memory leaks.
			for await (let event of ctx.umbreld.eventBus.stream(input.event, {signal})) {
				// Reformat the file:change event so it's suitable to be consumed by the client
				if (input.event === 'file:change') {
					// Clone event to avoid mutating the original event object
					event = cloneDeep(event) as EventTypes['file:change']

					// Convert the system path to a virtual path
					event.path = ctx.umbreld.files.systemToVirtualPath(event.path)
				}

				// Stream the event to the client
				yield event
			}
		}),
})
