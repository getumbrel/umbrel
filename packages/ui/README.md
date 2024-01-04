# Umbrel OS UI

## Getting Umbrel OS running locally

### Prerequisites

`npm` and `pnpm` is installed.

First install `pnpm`. One way is via `brew install pnpm` on mac, assuming you have homebrew installed.

### Clone the repo and checkout the `mark` branch

`git clone -b mark git@github.com:getumbrel/private-umbrel.git`

### Go into the repo

`cd private-umbrel`

### Get frontend running

1. `cd packages/ui`
1. `pnpm install`
1. `pnpm run dev`

### Get backend running

1. Get back to the root of the repo and `cd` into umbreld: `cd packages/umbreld`
1. Make the dir for the data: `mkdir data`
1. `npm install`
1. `npm run dev`

## Sharing semi-publicly (on Mac)

1. [Get the CLI](https://tailscale.com/kb/1080/cli/#using-the-cli)
2. Add this to your `.zshrc` or `.bashrc`:

```sh
alias tailscale="/Applications/Tailscale.app/Contents/MacOS/Tailscale"
```

3. Run `tailscale serve`:

```sh
tailscale serve http:3000 / http://127.0.0.1:3000
```

4. For production:

```sh
tailscale serve http:4000 / http://127.0.0.1:4000
```

Running on HTTP for now. HTTPS would be a bit more complicated. The prod build is especially important for getting a true sense of performance on mobile since the dev build will have extra cruft.

---

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

## tRPC

Prefer `trpcReact` over `trpcClient` because it lets you manage error and loading state, caching, and invalidation. More info here: https://trpc.io/docs/client/vanilla#when-not-to-use-the-vanilla-client
