import type {Fn} from '../runtime'
import {dateFunctions} from './date'
import {logicalFunctions} from './logical'
import {lookupFunctions} from './lookup'
import {math} from './math'
import {statistics} from './statistics'
import {textFunctions} from './text'

// Everything else (RAND, OFFSET, INDIRECT, LET, FILTER...) is unknown, and
// formulas using it keep their cached value as stale
export const FUNCTIONS = new Map<string, Fn>(
	Object.entries({...math, ...statistics, ...logicalFunctions, ...textFunctions, ...lookupFunctions, ...dateFunctions}),
)
