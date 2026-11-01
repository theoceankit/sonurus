---
sidebar_position: 3
---

# New UI foundations

What every component of the new UI in `ui/` builds on: tokens, the theme mechanism, the font, icons, two layout components and the base controls. See them in Storybook under Foundations and Components (`npm --prefix ui run storybook`).

## Tokens

`ui/src/styles/tokens.css` is the single source of design values. It was exported once from Penpot and is edited by hand; nothing generates it and nothing syncs it back.

| Layer | Where | Used by |
|---|---|---|
| Palette: `--gray-900`, `--iris-a12` | `:root` | the theme blocks only |
| Scale: `--space-2`, `--radius-md`, `--size-icon-sm` | `:root` | components |
| Type: `--font-body`, `--type-size-title` | `:root` | components |
| Semantic: `--color-text-primary`, `--shadow-md` | the theme blocks | components |

`--font-*` tokens are values for the `font` property: `font: var(--font-body-strong)`.

## Theme

The `data-theme` attribute selects the semantic values. `ui/index.html` sets `data-theme="light"` on the root. Dark values exist, but the app has no way to turn them on yet and screens have not been checked in them; the Storybook toolbar switches themes.

The attribute works on any element, so a page can show both themes side by side. Shadows are defined per theme for the same reason: they refer to theme colours, and on `:root` alone they would resolve to the light values everywhere.

## Raw values

`ui/src/styles/raw-values.test.ts` walks the sources and fails on:

- colour literals in `*.module.css`: hex, `rgb()`, `hsl()` and the like, common colour names;
- lengths in `margin*`, `padding*`, `gap`, `row-gap`, `column-gap`, `inset*`, `top`, `right`, `bottom`, `left`;
- palette tokens used directly;
- colours and lengths in `style` props in TSX;
- an `<svg>` element anywhere but `Icon`.

Allowed: `0`, `auto`, `var()`, `calc()` over `var()`, percentages, keywords such as `transparent` and `currentColor`. Widths and heights are not checked, since column and modal sizes are layout decisions rather than spacing.

An exception is a comment with a reason on the line before the declaration:

```css
/* raw-value: avatars in a stack overlap by a fixed amount */
margin-left: -5px;
```

## Font

Inter 4.1, the official static web files for weights 400 and 600, in `ui/src/assets/fonts/`. They include Cyrillic and are not cut into subsets. Scripts outside Inter fall back to the system font. The licence ships with the build as `licenses/Inter-LICENSE.txt`, from `ui/public/`.

The fonts stay separate files (`assetsInlineLimit: 0` in `ui/vite.config.ts`) because the CSP allows no `data:` URLs.

## Icons

`ui/src/assets/icons/<name>.svg`, with `currentColor` and the names from Penpot. Add a file together with its name in `ui/src/components/Icon/icon-names.ts`; a test keeps the two in step.

```tsx
<Icon name="search" />                      // 16 px, hidden from assistive technology
<Icon name="close" size={12} label="Close" />
```

| Size | Token | Stroke |
|---|---|---|
| 12 | `--size-icon-xs` | 1 px |
| 14 | `--size-icon-xs-plus` | 1 px |
| 16 | `--size-icon-sm` | 1 px |
| 20 | `--size-icon-md` | 1.25 px |
| 24 | `--size-icon-lg` | 1.5 px |

`Icon` puts the shapes inline, not in an image or a CSS mask as the old UI does, because a stroke width set in CSS cannot reach an external file. Strokes are centred on the path. On the 24 grid the path coordinates sit on 0.75 + n × 1.5, which makes the 1 px stroke crisp at 16. Penpot draws closed paths with an inner stroke, so closed shapes here are up to 0.5 px larger at 16 than on the boards.

Filled icons (`play`, `pause` and others) have `fill="currentColor"` on the path, logos also `stroke="none"` and `fill-rule="evenodd"`.

The old UI keeps its own files in `electron/assets/icons/` until the switch.

## Stack and Inline

A column and a row. Spacing props accept only the steps of the scale: `'half'`, `1`, `2`, `3`, `4`, `5`, `6`, `8`.

```tsx
<Stack gap={2} padding={4}>…</Stack>
<Inline gap={1} paddingX={3} paddingY={1} justify="between">…</Inline>
```

Both take `as`, `align`, `justify`, `className`, `ref` and other props of the element; `Inline` also takes `wrap` and centres its items by default. The Penpot group `layout/` (titlebar, sidebar, inspector and others) is a set of screen components, not these two.

## Base controls

`Button`, `IconButton`, `Avatar`, `AvatarStack`, `Tab`, `Tabs`, `TextField`, `SearchField`, `MenuItem`, `Disclosure`, `ColorSwatch`, `ColorPicker`, `Kbd`, `Badge`, `SectionHeader` and `MetaItem`, in `ui/src/components/`, named after their Penpot components.

Penpot's Type is the `variant` prop, because `type` on a button is the HTML attribute. Pairs that do not exist on the boards, such as an inverse button at medium size, are type errors. `Tabs`, `ColorPicker` and `Disclosure` are built on Radix Primitives, which bring the arrow keys and the tab order; `Tab` works only inside `Tabs`, `ColorSwatch` only inside a radio group. `Button`, `IconButton` and `MenuItem` pass on `ref` and other attributes, so Radix can wrap them with `asChild`.

### States

`ui/src/styles/control.module.css` holds what controls share, taken with `composes`:

- `stateLayer` draws Hover and Pressed as a layer under the content. A control sets `--state-hover` and `--state-pressed` when its layer is not `--color-fill-hover` and `--color-fill-pressed`.
- `focusRing` draws the ring on `:focus-visible`, two pixels away from the control. `MenuItem`, `Tab` and `Disclosure` draw their own: inside the row, or wider than it is tall.
- `reset` removes the browser's button styling.

### Stories

Each component with states has a `Matrix` story from `ui/src/foundations/StateMatrix.tsx`: rows and columns like its Penpot board. `storybook-addon-pseudo-states` forces Hover, Pressed and Focus, so the components' CSS has nothing only for Storybook. It forces them on everything inside a cell, so the clear button in a hovered `SearchField` looks hovered too.

### Avatar

Only `Avatar` works out initials; a test in `Avatar.test.tsx` fails if anything else imports them.

- One word gives its first two letters, several give the first letter of the first and of the last word. `xs` shows one letter. An empty name is a circle without letters.
- A colour is a number from 1 to 6. Which speaker gets which is decided by the data layer.
- `kind="unknown"` and `kind="unassigned"` are a gray "?".
- `AvatarStack` puts the first avatar on top and turns speakers past `max` into "+N".

### Escape in SearchField

A first Escape in a filled field clears it and goes no further; in an empty field it goes on, so a dialog around the field can close. Radix layers listen for Escape on the document in the capture phase, before any handler on the field, so the field listens on the window in the same phase while it is filled.

`TextField` has no reaction of its own to Escape: cancelling an edit belongs to the screen.
