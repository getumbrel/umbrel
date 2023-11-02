# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react/README.md) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

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
