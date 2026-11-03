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
- The initials are trimmed to their capitals with `text-box`, so the letters are what is centred, not the line box, which at these sizes leaves them a pixel high. At 20 px the capitals are an odd height, so they stay within half a pixel of the centre.
- `AvatarStack` puts the first avatar on top and turns speakers past `max` into "+N".

### Escape in SearchField

A first Escape in a filled field clears it and goes no further; in an empty field it goes on, so a dialog around the field can close. Radix layers listen for Escape on the document in the capture phase, before any handler on the field, so the field listens on the window in the same phase while it is filled.

`TextField` has no reaction of its own to Escape: cancelling an edit belongs to the screen.

## ScrollBar

The system bar is off everywhere (`base.css`): on Linux it draws arrows, and Chromium does not repaint the parts of a styled one when the pointer comes over the area. `ScrollBar` stands in for it, as the next sibling of the scrolling element, in the same positioned parent:

```tsx
const { area, scrollRef } = useScrollEdges()

<div ref={scrollRef} className={styles.scrolls}>…</div>
<ScrollBar area={area} />
```

It shows while the pointer is over the parent, while the area scrolls and while the thumb is dragged, and takes no width from the area.

## Motion

One standard for everything that moves, seen in Storybook under Foundations/Motion. Screens take values from the tokens, and `raw-values.test.ts` fails on a literal duration or curve in a `*.module.css`, on `transition: all`, and on a literal `scale` or `translate`.

### Principles

1. Motion says where a thing came from and where it went. It decorates nothing.
2. An action shows on the first frame, and input does not wait for an animation to end. What is opening can be closed.
3. Most of the way is covered at the start: the curves decelerate hard, so a thing is nearly in place after the first few frames.
4. Nothing takes longer than 200 ms, except panels (250 ms, the furthest travel), the spinner and the bar of the playing segment.
5. Closing is shorter than opening.
6. Only `opacity` and `transform` move. Size changes only for a panel, for what opens in place and for the bubble of the player.
7. Nothing loops unless it reports a process, as the spinner does.

### Tokens

| Token | Value | For |
|---|---|---|
| `--duration-fast` | 100 ms | hover, tooltip, closing a menu |
| `--duration-base` | 150 ms | opening a menu, closing a modal or a toast |
| `--duration-slow` | 200 ms | opening a modal or a toast, what opens in place |
| `--duration-move` | 250 ms | panels, which travel the furthest |
| `--ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | what stays on screen: panels, height, width, colour |
| `--ease-enter` | `cubic-bezier(0.16, 1, 0.3, 1)` | what appears |
| `--ease-exit` | `cubic-bezier(0.4, 0, 1, 1)` | what leaves the screen |
| `--motion-scale` | 0.96 | what grows as it appears |
| `--motion-shift-sm`, `--motion-shift-md` | 2 px, 8 px | what rises as it appears |

### What moves

| Element | Opens | Closes | How |
|---|---|---|---|
| Hover | 100 | 100 | colour only |
| Tooltip | 100 | 100 | fade and 2 px; the next within 300 ms and one from the keyboard come at once |
| Menu, popup | 150 | 100 | fade and scale from where it hangs |
| Modal and scrim | 200 | 150 | fade and scale; Choose speaker and New speaker turn into each other with neither |
| Toast | 200 | 150 | fade and 8 px up |
| Panel, on its button | 250 | 250 | the frame moves, the text wraps on every frame, the panel's content fades |
| What opens in place | 200 | 150 | height and fade: Show N more, Disclosure, the text of a review card, the review dock |
| Show inspector | 200 | — | from 8 px to the side the inspector leaves to, once the panel is half way out; it goes at once, as the inspector takes its place |
| Bubble of the player | 100 | 100 | width, when the text has changed it |

Pressed and the focus ring change at once. So do the text and data of the transcript, the playhead and the waveform, scrolling, changing recording, tabs and editing a paragraph.

### How it is built

- `ui/src/styles/motion.module.css` holds the rules, taken with `composes`. A component sets `--motion-in`, `--motion-out`, `--motion-from-scale`, `--motion-to-scale` and `--motion-from-shift`. Scale and shift use the `scale` and `translate` properties, which do not fight the `transform` that centres a modal or that Radix positions with.
- Radix keeps an element until the animation of `data-state="closed"` has ended. What is shown for a value of state needs that value until then: `useLingering()` in `ui/src/presence.tsx` keeps it, and `ExitSignal` inside the element says when it is gone.
- `Collapse` and `Disclosure` take their height from Radix, with no measuring of their own. Radix measures the content as it would be on its own, so a block that the layout squeezes, such as the review dock in a low inspector, would grow past its place and jump back at the end. `Reveal` is for such content: it moves on grid rows (`0fr` to `1fr`), which reach the height the layout gives, and on the way the content keeps the size it has at the end it comes from or goes to, cut at the bottom rather than squeezed. The review dock and the text of a review card use it. It keeps its content until the way out is over.
- `appear` in `motion.module.css` plays the way in of something that is simply mounted, with no state to play out, as the Show inspector button. `--motion-delay` holds it back: that button answers no click of its own, and come at once it would be over before the eye gets there.
- `EditorScreen` always has three columns, because the number of columns cannot animate, and a closed panel's column has no width. The move is marked with `data-moving` on the element, not in state, so its end renders nothing. The text of the centre wraps again on every frame, as in native apps: on a three-hour recording that is under 2 ms of layout a frame. Wrapping once for the width it is heading for was tried and dropped: the text jumped on the first frame and was cut off by the frame or left a gap beside it. A window being resized follows at once.

### Long recordings

Nothing may walk the rows of a transcript and read their layout. `getBoundingClientRect` on a turn hidden by `content-visibility` lays it out: over a three-hour recording that takes hundreds of milliseconds. Storybook's highlight module does this on any change of the page, so measure a long recording in the app or on Vite with fixtures, not in Storybook.

### Reduced motion

The system setting empties the distance tokens in `tokens.css`, so what fades still fades. What opens in place only fades, the bubble changes width at once, panels do not move and the bar of the playing segment stands whole. The spinner keeps turning: it reports a process. There is no setting for this in the app.

## Overlays

`Tooltip`, `Menu`, `Toolbar`, `Toast`, `ScrollFade`, `Modal`, `ModalHeader`, `ModalBody` and `ModalFooter`, in `ui/src/components/`. Tooltips, menus, toolbars, toasts and modals are built on Radix Primitives. `OverlayProvider` wraps the app in `ui/src/main.tsx` and every story in `ui/.storybook/preview.tsx`: it holds the tooltip timing and the one `Toaster`.

### Layers

`--z-modal`, `--z-popover` and `--z-toast` in `tokens.css`, in that order, so a menu or a tooltip opens over a modal and a toast stays over everything. A toast stays clickable over a modal, also one that was open before the modal: Radix sets `pointer-events: none` on the body and on the layers under the modal, and `Toast.module.css` overrides that.

The topmost layer takes Escape. With a toast on screen over a modal, the first Escape closes the toast and the next one closes the modal. Radix decides this, and a toast is gone in seconds anyway.

### Tooltip

`placement` is `above`, `below` or `none`, which has no arrow and shows above. Without room on the chosen side it takes the other one. A pointer waits 400 ms, the next tooltip within 300 ms shows at once, and keyboard focus shows it at once. The text is a string. Other props go to the trigger, so a menu can open from a control with a tooltip.

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

One stop for Tab, arrows move inside it. The screen decides where it stands and when it shows. `ToolbarAction` is a button with only an icon, which names itself in a tooltip: `<ToolbarAction icon="play" label="Play" />`.

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

The control stays visible and focusable, dimmed with `--opacity-disabled`, with the default cursor and `aria-disabled`. Activating it shows "Not available yet" and reaches none of its handlers, nor those of the controls inside a marked container.

The function returns props instead of relying on a global click guard, because Radix does not wait for a click: tabs switch on mousedown and on focus, menus act on pointerup and on the keydown of Enter and Space. Capture handlers stop all of these.

`NOT_IMPLEMENTED` lists the ids, and an id that is not in it is a compile error. `not-implemented.test.tsx` fails when an id has no call or several, when a call has no id or a computed one, and on a control's own "not available" text; stories and tests do not count. The list holds only what the new UI already renders: an old id moves here with its screen. Stories use `notImplementedProps()`, which takes any string.
