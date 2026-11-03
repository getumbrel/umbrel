// A table looked up by what a file says: only its own entries answer, never what every object inherits
// ("constructor", "toString"), which a crafted file could name to break the code that reads the answer
export const lookup = <T>(entries: Record<string, T>): Readonly<Partial<Record<string, T>>> =>
	Object.assign(Object.create(null) as Record<string, T>, entries)
