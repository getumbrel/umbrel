export type ReadLane = 'interactive' | 'bulk'
export type SqlRead = {sql: string; parameters: unknown[]; all?: boolean}
export type ReadSql = (query: SqlRead, priority?: number, lane?: ReadLane) => Promise<unknown>

// Only statement data crosses the worker boundary. Callbacks and application
// state stay on the writer thread; the SELECT executes on a read-only connection.
export function readDatabase(read: ReadSql, priority = 0, lane: ReadLane = 'interactive') {
	return {
		prepare: (sql: string) => ({
			get: (...parameters: unknown[]) => read({sql, parameters}, priority, lane),
			all: (...parameters: unknown[]) => read({sql, parameters, all: true}, priority, lane),
		}),
	}
}

export type ReadDatabase = ReturnType<typeof readDatabase>
