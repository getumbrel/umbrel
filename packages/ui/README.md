# umbrelOS UI

# Decisions / common patterns

## `keyBy`

Using `remeda` instead of `lodash` because it's more typesafe. Lodash `keyBy` adds 14kb after minifcation and doesn't return proper types.

## `foobarDescription` format for static data

For lots of static data we want to maintain order and have it indexed. For a nav menu, we want a slug and a string for each element. We call them descriptions if it's an array with each element having an `id` and `label`. So we do this:

```ts
const navDescriptions = [
  {
    id: 'home',
    label: 'Home'
  }
  {
    id: 'about',
    label: 'About'
  }
] as const // <-- important

const navDescriptionsKeyed = keyBy(navDescriptions, 'id')
```

## Adding view transition support to elements

EX:

```tsx
<div
	style={{
		viewTransitionName: 'box',
	}}
>
	Box
</div>
```

You can then search the repo for `viewTransitionName` to find them all

## Event handler naming in React components

Use `onFooBarClick` rather than `onClickFooBar`

## No barrel files

Vite doesn't like them. Haven't tested how bad they are for performance, though.
https://vitejs.dev/guide/performance#avoid-barrel-files

## tRPC

Prefer `trpcReact` over `trpcClient` because it lets you manage error and loading state, caching, and invalidation. More info here: https://trpc.io/docs/client/vanilla#when-not-to-use-the-vanilla-client

## Error boundaries

Organize error boundaries to avoid them crashing headings and navigation elements.

For most cases, `ErrorBoundaryComponentFallback` is best. But when that's not possible because the error text won't have a place to go, then use `ErrorBoundaryPageFallback`.

---

# TROUBLESHOOTING

## TypeScript errors in code that don't make sense in VSCode

Restarting the TS server via the command palette fixes it. I haven't run into a situation where this doesn't fix it.
