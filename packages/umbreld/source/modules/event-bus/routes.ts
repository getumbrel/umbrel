import z from 'zod'
import {TRPCError} from '@trpc/server'

import {router, privateProcedureWithMembers} from '../server/trpc/trpc.ts'
import {OWNER_USER_ID} from '../user/constants.ts'
import type {OperationsInProgress} from '../files/files.ts'

import {type EventTypes, events} from './event-bus.ts'

// The only events member accounts may listen to. Each one is filtered down to
// what belongs to the member before it's streamed, or carries no payload at
// all, everything else is owner-only, so nothing is ever streamed to members
// without an explicit, scoped opt-in below.
const memberAllowedEvents = new Set<(typeof events)[number]>([
	'files:operation-progress',
	'files:cloud-progress',
	'files:watcher:change',
	'files:member-shares:change',
	'apps:member-shares:change',
	// Payload-free ping; members refetch their own account-filtered list
	'notifications:change',
	'photos:change',
	'photos:indexing-progress',
])

export default router({
	// Listen for events
	listen: privateProcedureWithMembers
		.input(
			z.object({
				event: z.enum(events),
			}),
		)
		.subscription(({ctx, input, signal}) => {
			const userId = ctx.principal?.accountId ?? OWNER_USER_ID
			const isMember = userId !== OWNER_USER_ID

			// Members may only listen to explicitly whitelisted, per-account filtered
			// events. Checked here (not inside the generator) so the subscription is
			// rejected at creation, a generator body only runs once it's first pulled
			// which is after the client has already been told it started.
			if (isMember && !memberAllowedEvents.has(input.event)) {
				throw new TRPCError({code: 'FORBIDDEN', message: 'This action can only be performed by the owner'})
			}

			// Stream the events
			// We pass in the AbortSignal so the stream can be immediately cleaned up
			// when the client disconnects to avoid memory leaks.
			const eventStream = ctx.umbreld.eventBus.stream(input.event, {signal})
			return (async function* () {
				try {
					// Progress events are snapshots rather than deltas. The stream is
					// already attached before this read, so a concurrent update queues
					// behind the seed instead of being lost in a subscribe-time gap.
					if (input.event === 'files:operation-progress') {
						yield ctx.umbreld.files.operationsInProgress.filter((operation) => operation.userId === userId)
					}
					if (input.event === 'files:cloud-progress') {
						yield ctx.umbreld.files.cloud.getActivity(userId)
					}
					if (input.event === 'photos:indexing-progress') {
						try {
							yield await ctx.umbreld.photos.indexingState(userId)
						} catch (error) {
							// The subscription can connect before the file-index worker is ready
							// during startup. Keep listening: the first indexing update will seed
							// the client once the worker and Photos database become available.
							ctx.logger.error('Failed to seed Photos indexing progress subscription', error)
						}
					}

					for await (let event of eventStream) {
						if (input.event === 'photos:change') {
							const change = event as EventTypes['photos:change']
							if (!change.accountIds.includes(userId)) continue
							if (isMember) event = {accountIds: [userId]} as EventTypes['photos:change']
						}
						if (input.event === 'photos:indexing-progress') {
							const progress = event as EventTypes['photos:indexing-progress']
							if (progress.accountId !== userId) continue
							yield progress.state
							continue
						}
						// Reformat the files:watcher:change event so it's suitable to be consumed by the client
						if (input.event === 'files:watcher:change') {
							// Copy the event rather than mutating the one every subscriber shares,
							// converting the system path to a virtual path. It's flat, so a
							// shallow copy is enough and cheaper than a deep clone for every event.
							const change = event as EventTypes['files:watcher:change']
							event = {...change, path: ctx.umbreld.files.systemToVirtualPath(change.path)}

							// Members only receive changes to paths their account owns or
							// paths the owner shared with them
							if (isMember && ctx.umbreld.files.ownerOfPath(event.path) !== userId) {
								const share = await ctx.umbreld.files.memberShares.shareGrantFor(event.path, userId)
								if (!share) continue
							}
						}

						// Every account only receives progress for its own file operations
						if (input.event === 'files:operation-progress') {
							const operations = event as OperationsInProgress
							event = operations.filter((operation) => operation.userId === userId)
						}

						// Cloud wake-ups are account-scoped before anything is yielded,
						// so one account cannot infer another account's transfer timing.
						if (input.event === 'files:cloud-progress') {
							const progress = event as EventTypes['files:cloud-progress']
							if (progress.userId !== userId) continue
							yield progress.activity
							continue
						}

						// Members only receive share changes that affect their own account,
						// and only learn about their own involvement (not the other grantees)
						if (
							isMember &&
							(input.event === 'files:member-shares:change' || input.event === 'apps:member-shares:change')
						) {
							const change = event as EventTypes['files:member-shares:change']
							if (change.sharedWith !== 'all' && !change.sharedWith.includes(userId)) continue
							event = {sharedWith: [userId]} as EventTypes['files:member-shares:change']
						}

						// Stream the event to the client
						yield event
					}
				} finally {
					await eventStream.return?.()
				}
			})()
		}),
})
