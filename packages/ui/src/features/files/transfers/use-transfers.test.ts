// @vitest-environment jsdom

import {describe, expect, test, vi} from 'vitest'

import type {TransferItem, TransfersSnapshot} from './types'
import {buildTransfersView, LANDED_MS} from './use-transfers'

vi.mock('@/trpc/trpc', () => ({trpcReact: {}, trpcClient: {}}))
vi.mock('@/providers/confirmation', () => ({useConfirmation: () => vi.fn()}))
vi.mock('@/features/files/store/use-files-store', () => ({useFilesStore: {getState: () => ({})}}))
vi.mock('@/modules/auth/http-auth', () => ({dashboardAuthHeaders: () => ({})}))

const base: TransferItem = {
	id: '',
	batchId: 'b1',
	kind: 'upload',
	lane: 'upload',
	name: '',
	type: 'file',
	path: '',
	destinationDirectory: '/Home/Photos',
	state: 'queued',
	progress: 0,
	transferredBytes: 0,
	bytesPerSecond: 0,
	attempts: 0,
}

function snapshot(items: Partial<TransferItem>[], batchKind: TransferItem['kind'] = 'upload'): TransfersSnapshot {
	const full = items.map((item, index) => ({...base, id: `i${index}`, name: `f${index}`, kind: batchKind, ...item}))
	return {
		batches: [
			{id: 'b1', kind: batchKind, destinationDirectory: '/Home/Photos', createdAt: 0, itemIds: full.map((i) => i.id)},
		],
		items: new Map(full.map((item) => [item.id, item])),
		wake: 0,
	}
}

describe('buildTransfersView', () => {
	test('upload progress is byte-weighted and keeps finished bytes as rows settle', () => {
		const view = buildTransfersView(
			snapshot([
				{size: 100, state: 'completed'},
				{size: 100, state: 'running', transferredBytes: 50, bytesPerSecond: 25},
				{size: 100, state: 'queued'},
				{size: 100, state: 'cancelled'},
			]),
			[],
		)
		const [batch] = view.batches
		expect(batch.counts).toMatchObject({total: 3, completed: 1, running: 1, queued: 1, cancelled: 1})
		expect(batch.progress).toBe(50)
		expect(batch.bytesPerSecond).toBe(25)
		expect(batch.secondsRemaining).toBe(6)
		expect(batch.destinationName).toBe('Photos')
		expect(view.primary?.id).toBe('b1')
	})

	test('rows put what needs the user first, then keep queue order, capped with a remainder', () => {
		const view = buildTransfersView(
			snapshot([
				{state: 'completed', settledAt: 10_000},
				{state: 'running'},
				{state: 'queued'},
				{state: 'failed', error: '[x]'},
				{state: 'needs-attention', conflict: {dismissed: true}},
				{state: 'queued'},
				{state: 'queued'},
				{state: 'queued'},
			]),
			[],
			10_000 + LANDED_MS + 1,
		)
		const [batch] = view.batches
		// Running stays where it was in the queue; a row never jumps when it starts
		expect(batch.rows.map((row) => row.state)).toEqual(['failed', 'needs-attention', 'running', 'queued', 'queued'])
		expect(batch.hiddenCount).toBe(2)
		expect(batch.status).toBe('attention')
		expect(view.counts).toMatchObject({running: 1, queued: 4, attention: 1, failed: 1})
	})

	test('a just-landed row lingers above the window, then leaves on the clock', () => {
		const items = [
			{state: 'completed' as const, settledAt: 5_000},
			{state: 'completed' as const, settledAt: 9_800},
			{state: 'running' as const},
			{state: 'queued' as const},
			{state: 'queued' as const},
			{state: 'queued' as const},
			{state: 'queued' as const},
			{state: 'queued' as const},
		]
		const fresh = buildTransfersView(snapshot(items), [], 10_000)
		expect(fresh.batches[0].rows.map((row) => row.state)).toEqual([
			'completed',
			'running',
			'queued',
			'queued',
			'queued',
			'queued',
		])
		// The landed row is extra: the window below it is unchanged, so nothing churns
		expect(fresh.batches[0].hiddenCount).toBe(1)
		const later = buildTransfersView(snapshot(items), [], 9_800 + LANDED_MS)
		expect(later.batches[0].rows.map((row) => row.state)).toEqual(['running', 'queued', 'queued', 'queued', 'queued'])
	})

	test('server progress is laid over running copies and claimed from the operations island', () => {
		const operations = [
			{
				id: 'op1',
				type: 'copy' as const,
				userId: 'u',
				file: {name: 'f0', path: '/Home/f0', type: 'file', modified: 0, operations: []},
				destinationPath: '/Home/Photos/f0',
				percent: 40,
				bytesPerSecond: 1000,
				secondsRemaining: 12,
			},
			{
				id: 'op2',
				type: 'move' as const,
				userId: 'u',
				appId: 'jellyfin',
				file: {name: 'data', path: '/Apps/jellyfin/data', type: 'directory', modified: 0, operations: []},
				destinationPath: '/External/Drive/jellyfin',
				percent: 10,
				bytesPerSecond: 5,
			},
		]
		const view = buildTransfersView(
			snapshot(
				[
					{sourcePath: '/Home/f0', state: 'running'},
					{sourcePath: '/Home/f1', state: 'queued'},
				],
				'copy',
			),
			operations,
		)
		const [batch] = view.batches
		expect(batch.rows[0]).toMatchObject({progress: 40, bytesPerSecond: 1000, secondsRemaining: 12})
		expect(batch.progress).toBe(20)
		expect(view.managedOperations.map((op) => op.id)).toEqual(['op2'])
		// Server work in flight survives the page; the queued item does not
		expect(view.hasBrowserBoundWork).toBe(true)
	})

	test('the island is named by what it holds', () => {
		expect(buildTransfersView(snapshot([{state: 'queued'}]), []).kind).toBe('upload')
		expect(buildTransfersView(snapshot([{sourcePath: '/Home/a', state: 'queued'}], 'copy'), []).kind).toBe('copy')
		const mixed = buildTransfersView(
			{
				...snapshot([{state: 'queued'}]),
				batches: [
					{id: 'b1', kind: 'upload', destinationDirectory: '/Home', createdAt: 0, itemIds: ['i0']},
					{id: 'b2', kind: 'move', destinationDirectory: '/Home', createdAt: 1, itemIds: []},
				],
			},
			[],
		)
		expect(mixed.kind).toBe('mixed')
		expect(buildTransfersView({batches: [], items: new Map(), wake: 0}, []).kind).toBe('upload')
	})

	test('unowned ordinary copies join the island read-only; app and Rewind work stays managed', () => {
		const operations = [
			{
				id: 'op1',
				type: 'copy' as const,
				userId: 'u',
				file: {
					name: 'DJI.DNG',
					path: '/External/Card/DJI.DNG',
					type: 'image/dng',
					size: 40,
					modified: 0,
					operations: [],
				},
				destinationPath: '/Home/DJI.DNG',
				percent: 59,
				bytesPerSecond: 103_000,
				secondsRemaining: 120,
			},
			{
				id: 'op2',
				type: 'move' as const,
				userId: 'u',
				appId: 'jellyfin',
				file: {name: 'data', path: '/Apps/jellyfin/data', type: 'directory', modified: 0, operations: []},
				destinationPath: '/External/Drive/jellyfin',
				percent: 10,
				bytesPerSecond: 5,
			},
			{
				id: 'op3',
				type: 'copy' as const,
				userId: 'u',
				file: {name: 'notes', path: '/Backups/x/Home/notes', type: 'directory', modified: 0, operations: []},
				destinationPath: '/Home/notes',
				percent: 10,
				bytesPerSecond: 5,
			},
		]
		const view = buildTransfersView({batches: [], items: new Map(), wake: 0}, operations)
		expect(view.batches.map((batch) => batch.id)).toEqual(['operation:op1'])
		expect(view.batches[0]).toMatchObject({
			kind: 'copy',
			destinationName: 'Home',
			progress: 59,
			cancellable: false,
			status: 'active',
		})
		expect(view.batches[0].rows[0]).toMatchObject({
			name: 'DJI.DNG',
			state: 'running',
			progress: 59,
			secondsRemaining: 120,
		})
		expect(view.kind).toBe('copy')
		expect(view.managedOperations.map((op) => op.id)).toEqual(['op2', 'op3'])
		expect(view.hasBrowserBoundWork).toBe(false)
	})

	test('the same source copied to two places keeps each record with its own destination', () => {
		const file = {name: 'f0', path: '/Home/f0', type: 'file', modified: 0, operations: []}
		const operations = [
			{
				id: 'toB',
				type: 'copy' as const,
				userId: 'u',
				file,
				destinationPath: '/Home/Photos/f0',
				percent: 20,
				bytesPerSecond: 1,
			},
			{
				id: 'toC',
				type: 'copy' as const,
				userId: 'u',
				file,
				destinationPath: '/Home/Videos/f0',
				percent: 90,
				bytesPerSecond: 1,
			},
		]
		const view = buildTransfersView(snapshot([{sourcePath: '/Home/f0', state: 'running'}], 'copy'), operations)
		// This batch copies into Photos: it shows 20%, and the copy into Videos
		// from elsewhere appears as its own read-only batch
		expect(view.batches.map((batch) => [batch.id, batch.progress])).toEqual([
			['operation:toC', 90],
			['b1', 20],
		])
	})

	test('a pending collision dialog is reported so the island can hold itself open', () => {
		expect(
			buildTransfersView(snapshot([{state: 'needs-attention', conflict: {dismissed: false}}]), []).promptOpen,
		).toBe(true)
		expect(buildTransfersView(snapshot([{state: 'needs-attention', conflict: {dismissed: true}}]), []).promptOpen).toBe(
			false,
		)
	})

	test('a record that outlives its just-settled item by a moment is not shown as unowned', () => {
		const operations = [
			{
				id: 'op1',
				type: 'copy' as const,
				userId: 'u',
				file: {name: 'f0', path: '/Home/f0', type: 'file', modified: 0, operations: []},
				destinationPath: '/Home/Photos/f0',
				percent: 100,
				bytesPerSecond: 0,
			},
		]
		const view = buildTransfersView(
			snapshot([{sourcePath: '/Home/f0', state: 'completed', settledAt: 10_000}], 'copy'),
			operations,
			10_500,
		)
		expect(view.batches.map((batch) => batch.id)).toEqual(['b1'])
	})

	test('a batch with nothing left but failures is failed; one with nothing left is done', () => {
		expect(buildTransfersView(snapshot([{state: 'failed'}, {state: 'completed'}]), []).batches[0].status).toBe('failed')
		expect(buildTransfersView(snapshot([{state: 'completed'}, {state: 'skipped'}]), []).batches[0].status).toBe('done')
		expect(buildTransfersView(snapshot([{state: 'completed'}]), []).cancellable).toBe(false)
	})
})
