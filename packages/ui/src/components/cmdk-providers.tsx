import React from 'react'

// Backups
import {BackupsCmdkSearchProvider} from '@/features/backups/cmdk-search-provider'
// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

// Files
import {FilesCmdkSearchProvider} from '@/features/files/cmdk-search-provider'

/**
 * ---------------------------------------------------------------------------
 * Command-K Search Providers
 * ---------------------------------------------------------------------------
 *
 * Each feature that wants to surface its own search results inside the global
 * command-k component should export a small React component that adheres to
 * the `CmdkSearchProvider` signature defined below.
 *
 * The component will be rendered inside the existing `<CommandList>` context so
 * it can directly return `CommandItem` elements.
 *
 * A very small, opinionated interface is intentionally chosen to keep things
 * straightforward: we just pass the current `query` and a helper to `close`
 * the palette once the provider performs its action (navigation, etc.).
 *
 * Providers are collected in the `cmdkSearchProviders` array (see bottom of
 * file). Currently only /features/files uses this, but new features should
 * add their provider to that array – in the future this could be automated via
 * code-generation or dynamic imports, but for now an explicit list keeps the
 * coupling minimal.
 */

export interface CmdkSearchProviderProps {
	// The current search query coming from the command-k input.
	query: string
	// Helper to close the command-k. Call it after executing the action
	close: () => void
}

export type CmdkSearchProvider = React.FC<CmdkSearchProviderProps>

export const cmdkSearchProviders: CmdkSearchProvider[] = [FilesCmdkSearchProvider, BackupsCmdkSearchProvider]
