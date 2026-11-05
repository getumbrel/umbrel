import {describe, expect, test} from 'vitest'

import {appPathForIdentity, registryAppPath, UMBREL_APP_STORE_ID} from '@/constants/app-store'
import type {RegistryApp} from '@/trpc/trpc'

import {indexRegistryApps, resolveDependencyRegistryApp, resolveRegistryAppsFirstWins} from './app-store-registry'

const registryApp = (registryId: string, id: string): RegistryApp =>
	({appStoreId: registryId, id, name: `${registryId}:${id}`}) as RegistryApp

const officialDependency = registryApp(UMBREL_APP_STORE_ID, 'bitcoin')
const communityDependency = registryApp('community-store', 'community-store-node')
const otherCommunityDependency = registryApp('other-community-store', 'other-community-node')
const repoAppsKeyed = {
	[UMBREL_APP_STORE_ID]: {bitcoin: officialDependency},
	'community-store': {'community-store-node': communityDependency},
	'other-community-store': {'other-community-node': otherCommunityDependency},
}

describe('indexRegistryApps', () => {
	test('indexes globally unique apps', () => {
		expect(
			indexRegistryApps([
				{meta: {id: UMBREL_APP_STORE_ID}, apps: [officialDependency]},
				{meta: {id: 'community-store'}, apps: [communityDependency]},
			]),
		).toEqual({
			appsKeyed: {bitcoin: officialDependency, 'community-store-node': communityDependency},
			ambiguousAppIds: new Set(),
		})
	})

	test('quarantines an ID shared by official and community stores', () => {
		const duplicateCommunityApp = registryApp('community-store', 'bitcoin')
		expect(
			indexRegistryApps([
				{meta: {id: UMBREL_APP_STORE_ID}, apps: [officialDependency]},
				{meta: {id: 'community-store'}, apps: [duplicateCommunityApp]},
			]),
		).toEqual({appsKeyed: {}, ambiguousAppIds: new Set(['bitcoin'])})
	})
})

describe('resolveRegistryAppsFirstWins', () => {
	test('keeps the first repository that lists an app ID', () => {
		const duplicateCommunityApp = registryApp('community-store', 'bitcoin')
		expect(
			resolveRegistryAppsFirstWins([
				{meta: {id: UMBREL_APP_STORE_ID}, apps: [officialDependency]},
				{meta: {id: 'community-store'}, apps: [duplicateCommunityApp]},
			]),
		).toEqual({bitcoin: officialDependency})
	})
})

describe('resolveDependencyRegistryApp', () => {
	test('prefers a dependency from the current community store', () => {
		expect(
			resolveDependencyRegistryApp({
				dependencyId: communityDependency.id,
				registryId: 'community-store',
				repoAppsKeyed,
			}),
		).toBe(communityDependency)
	})

	test('falls back from a community store to an official dependency', () => {
		const dependency = resolveDependencyRegistryApp({
			dependencyId: 'bitcoin',
			registryId: 'community-store',
			repoAppsKeyed,
		})
		expect(dependency).toBe(officialDependency)
		expect(registryAppPath(dependency!)).toBe('/app-store/bitcoin')
	})

	test('finds a uniquely matching dependency in another community store', () => {
		const dependency = resolveDependencyRegistryApp({
			dependencyId: 'other-community-node',
			registryId: 'community-store',
			repoAppsKeyed,
		})
		expect(dependency).toBe(otherCommunityDependency)
		expect(registryAppPath(dependency!)).toBe('/community-app-store/other-community-store/other-community-node')
	})

	test('does not resolve a missing community dependency', () => {
		expect(
			resolveDependencyRegistryApp({dependencyId: 'missing', registryId: 'community-store', repoAppsKeyed}),
		).toBeUndefined()
	})

	test('does not resolve an ambiguous dependency', () => {
		expect(
			resolveDependencyRegistryApp({
				dependencyId: 'bitcoin',
				registryId: 'community-store',
				repoAppsKeyed,
				ambiguousAppIds: new Set(['bitcoin']),
			}),
		).toBeUndefined()
	})

	test('defensively rejects duplicate matches without an ambiguity index', () => {
		expect(
			resolveDependencyRegistryApp({
				dependencyId: 'bitcoin',
				registryId: 'community-store',
				repoAppsKeyed: {
					...repoAppsKeyed,
					'other-community-store': {bitcoin: registryApp('other-community-store', 'bitcoin')},
				},
			}),
		).toBeUndefined()
	})
})

describe('registry-qualified app paths', () => {
	test('retains community identity while official apps use the default route', () => {
		expect(registryAppPath(communityDependency)).toBe('/community-app-store/community-store/community-store-node')
		expect(appPathForIdentity({registryId: UMBREL_APP_STORE_ID, appId: 'bitcoin'})).toBe('/app-store/bitcoin')
	})
})
