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

`composes` puts these rules wherever the first module that uses them loads, so every selector in the file sits in `:where()`. With no specificity of their own they lose to a component's rules from any place in the cascade. A test checks that.

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

## Overlays

`Tooltip`, `Menu`, `Toolbar`, `Toast`, `ScrollFade`, `Modal`, `ModalHeader`, `ModalBody` and `ModalFooter`, in `ui/src/components/`. Tooltips, menus, toolbars, toasts and modals are built on Radix Primitives. `OverlayProvider` wraps the app in `ui/src/main.tsx` and every story in `ui/.storybook/preview.tsx`: it holds the tooltip timing and the one `Toaster`.

### Layers

`--z-modal`, `--z-popover` and `--z-toast` in `tokens.css`, in that order, so a menu or a tooltip opens over a modal and a toast stays over everything. A toast stays clickable over a modal, also one that was open before the modal: Radix sets `pointer-events: none` on the body and on the layers under the modal, and `Toast.module.css` overrides that.

The topmost layer takes Escape. With a toast on screen over a modal, the first Escape closes the toast and the next one closes the modal. Radix decides this, and a toast is gone in seconds anyway.

### Tooltip

`placement` is `above`, `below` or `none`, which has no arrow and shows above. Without room on the chosen side it takes the other one. A pointer waits 400 ms, the next tooltip within 300 ms shows at once, and keyboard focus shows it at once. The text is a string.

### Menu

```tsx
<Menu trigger={<IconButton icon="more" label="More" />} align="end">
  <MenuAction icon="edit" onSelect={rename}>Rename</MenuAction>
  <MenuDivider />
  <MenuSection title="Model">
    <MenuOptions value={model} onValueChange={setModel}>
      <MenuOption value="base">base</MenuOption>
    </MenuOptions>
  </MenuSection>
</Menu>
```

Rows are `MenuItem`. A menu is not modal: a modal one locks the scroll and shifts the page behind it, and an outside click closes it all the same. `MenuSurface` is only the panel, for a menu that is not a list of actions, where focus stays in a search field.

Radix focuses the item under the pointer, and Chromium takes that focus for a keyboard one when nothing had focus before. So `Menu` remembers the last input in `data-input`, and the ring shows only after a key.

### Toolbar

```tsx
<Toolbar label="Paragraph">
  <ToolbarItem><IconButton icon="play" label="Play" /></ToolbarItem>
  <ToolbarDivider />
  <ToolbarItem><Button variant="toolbar" icon="copy">Copy</Button></ToolbarItem>
</Toolbar>
```

One stop for Tab, arrows move inside it. The screen decides where it stands and when it shows.

### Toast

`toast({ message, type, action, duration })` is a plain function, so code outside React can call it, and returns a function that takes the toast away. A toast stays 3.2 seconds, 6 with an action, and a pointer or focus stops the timer. At most three show, the oldest goes first.

An error toast takes its text from `--color-text-on-danger`, not `--color-text-on-inverse` as on the Penpot board. In the light theme they are the same; in the dark theme the second is dark on red.

### ScrollFade

```tsx
const { scrollRef, top, bottom } = useScrollEdges()

<div className={styles.relative}>
  <div ref={scrollRef} className={styles.scrolls}>…</div>
  {top && <ScrollFade edge="top" surface="raised" />}
  {bottom && <ScrollFade edge="bottom" surface="raised" />}
</div>
```

A neighbour of the scroll area, because a child would scroll away. The gradient runs from a surface token to `transparent`, so it follows the theme and needs none of the Penpot component's hard-coded colours. `surface` is `window`, `raised` for modals (in the dark theme it differs from the window) or `sunken`. `size` is `md`, or `lg` for the sidebar. The hook changes state only when an answer changes, so scrolling does not re-render.

### Modal

```tsx
<Modal size="medium" type="danger" open={open} onOpenChange={setOpen}>
  <ModalHeader title="Delete transcript?" description="…" icon="alert" />
  <ModalBody>…</ModalBody>
  <ModalFooter leading={<Button variant="ghost">…</Button>} confirm={{ children: 'Delete', onClick: remove }} />
</Modal>
```

What Penpot could make only by detaching a copy is plain children here. `ModalBody` scrolls when the window reaches the height of the screen, while the header and footer stay.

`ModalFooter` takes the colour of Confirm from the type of the modal. `cancel` is by default a Cancel that closes; given an `onClick`, it does that and stays open, as Back does; `null` leaves it out.

Tab stays inside, and Escape, the scrim, Cancel and the close button close. Focus starts on the first control of the body, then the footer, never on the close button first. A danger modal has the `alertdialog` role and starts on Cancel, so that an Enter pressed too soon deletes nothing. It is not a Radix AlertDialog, which would not close on the scrim. On closing, focus returns to what was focused before, and for a window opened from a menu, to the menu's button.

`preview` draws the window in place, without scrim and focus trap, for a board of variants in a story.

### Unimplemented controls

`ui/src/not-implemented.ts`, the new UI's counterpart of [Unimplemented controls](components/not-implemented.md):

```tsx
<Button {...markNotImplemented('titlebar.share')}>Share</Button>
```

The control stays visible and focusable, dimmed with `--opacity-disabled`, with a help cursor and `aria-disabled`. Activating it shows "Not available yet" and reaches none of its handlers, nor those of the controls inside a marked container.

The function returns props instead of relying on a global click guard, because Radix does not wait for a click: tabs switch on mousedown and on focus, menus act on pointerup and on the keydown of Enter and Space. Capture handlers stop all of these.

`NOT_IMPLEMENTED` lists the ids, and an id that is not in it is a compile error. `not-implemented.test.tsx` fails when an id has no call or several, when a call has no id or a computed one, and on a control's own "not available" text; stories and tests do not count. The list holds only what the new UI already renders: an old id moves here with its screen. Stories use `notImplementedProps()`, which takes any string.
