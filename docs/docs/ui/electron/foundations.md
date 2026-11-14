---
sidebar_position: 3
---

# Foundations

What every component of the UI in `ui/` builds on: tokens, the theme mechanism, the font, icons, two layout components and the base controls. See them in Storybook under Foundations and Components (`npm --prefix ui run storybook`).

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

`Icon` puts the shapes inline, not in an image or a CSS mask, because a stroke width set in CSS cannot reach an external file. Strokes are centred on the path. On the 24 grid the path coordinates sit on 0.75 + n × 1.5, which makes the 1 px stroke crisp at 16. Penpot draws closed paths with an inner stroke, so closed shapes here are up to 0.5 px larger at 16 than on the boards.

Filled icons (`play`, `pause` and others) have `fill="currentColor"` on the path, logos also `stroke="none"` and `fill-rule="evenodd"`.

## Stack and Inline

A column and a row. Spacing props accept only the steps of the scale: `'half'`, `1`, `2`, `3`, `4`, `5`, `6`, `8`.

```tsx
<Stack gap={2} padding={4}>…</Stack>
<Inline gap={1} paddingX={3} paddingY={1} justify="between">…</Inline>
```

`paddingTop` and `paddingBottom` pad one end only, for a slot whose neighbour pads the other; an end not asked for adds nothing, since even an empty `padding-block-start` or `-end` would clear that end of `paddingY` in a browser. Both take `as`, `align`, `justify`, `className`, `ref` and other props of the element; `Inline` also takes `wrap` and centres its items by default. The Penpot group `layout/` (titlebar, sidebar, inspector and others) is a set of screen components, not these two.

## Base controls

`Button`, `IconButton`, `Avatar`, `AvatarStack`, `Tab`, `Tabs`, `NavTab`, `Toggle`, `Slider`, `TextField`, `SearchField`, `MenuItem`, `Disclosure`, `ColorSwatch`, `ColorPicker`, `Kbd`, `Badge`, `SectionHeader` and `MetaItem`, in `ui/src/components/`, named after their Penpot components.

Penpot's Type is the `variant` prop, because `type` on a button is the HTML attribute. Pairs that do not exist on the boards, such as an inverse button at medium size, are type errors. `Tabs`, `ColorPicker` and `Disclosure` are built on Radix Primitives, which bring the arrow keys and the tab order; `Tab` works only inside `Tabs`, `ColorSwatch` only inside a radio group. `Button`, `IconButton` and `MenuItem` pass on `ref` and other attributes, so Radix can wrap them with `asChild`.

A `Button` with `loading` is busy at once: it ignores clicks and says so with `aria-busy`. What it shows changes only after 300 ms (`--delay-busy`), when a spinner takes the place of its icon and label, which stay under it out of sight. So a quick action ends with nothing changed, and a long one does not change the width of the button or move its neighbours.

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

### Settings controls

Settings brought controls that the Editor boards do not have; they follow the Editor's look and tokens.

- `Toggle` is an on/off `switch` that acts at once. It has no visible text of its own: `label` is what assistive technology reads, and the row next to it shows the words.
- `Slider` is vertical for the player's volume. `orientation="horizontal"` fills the width it is given; `marks` put labels under the track, the end ones inside the slider's width, and `valueText` is what assistive technology reads for a value such as 125%. `onCommit` comes when the pointer lets go or a key is released, for what is costly to apply.
- `Tabs` with `orientation="vertical"` is a column of `NavTab` rows (icon and label, the selected one filled as in the sidebar) with its panels next to it; up and down move through the column. `header` sits over the column, such as a search; `footer` under it, apart from the tabs.
- `FieldRow` is one setting: label and hint on the left, the control on the right at most `--size-field-control` wide, so a control never runs past its card at any window width. `stacked` puts the control under the label at the full width, for a slider with marks or a long field; `note` goes under the row. The row is a `group` named by its label; the control still has its own name.
- `Badge` has a medium size for a status that stands alone, such as the state of a card in Settings: the height of an extra small control and room around the text.
- `ModelRow` is one model of the catalog: an icon, the name with badges, size and the like as separate items, and the buttons of its state, which say the state without words next to them (Download; the percentage and Cancel; Use and delete; the reason and Retry). Its buttons line up in every row. A delete that cannot happen now is off with the reason in a tooltip. The default model's row is tinted, with Default under its name.
- `SectionCard` holds the rows that belong together, divided by lines, with an optional title, description, action next to the title and footer under the rows.

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
5. Closing is shorter than opening, except for what travels as far as a panel, which takes the panel's time both ways. Duration follows distance.
6. Only `opacity` and `transform` move. Size changes only for a panel, for what opens in place, for the bubble of the player and for a tooltip passing to its neighbour.
7. Nothing loops unless it reports a process, as the spinner does.

### Tokens

| Token | Value | For |
|---|---|---|
| `--duration-fast` | 100 ms | hover, tooltip, closing a menu |
| `--duration-base` | 150 ms | opening a menu, closing a modal or a toast |
| `--duration-slow` | 200 ms | opening a modal or a toast, what opens in place |
| `--duration-move` | 250 ms | panels, which travel the furthest |
| `--duration-shimmer` | 3200 ms | one cycle of the glint on text that is being worked on: half crossing, half resting |
| `--duration-pulse` | 2400 ms | one breath of the live dot of a recording, with `--ease-pulse` down to `--opacity-pulse-low` (0.6) and back |
| `--delay-hover` | 150 ms | how long the pointer stays on a speaker before it is highlighted |
| `--delay-hover-skip` | 300 ms | after a highlight, the next one comes at once for this long |
| `--delay-tooltip` | 300 ms | how long the pointer stays on a control before its tooltip shows |
| `--delay-tooltip-skip` | 300 ms | after a tooltip, the next one shows at once for this long |
| `--delay-busy` | 300 ms | how long a busy button looks as before, so a quick action shows no spinner |
| `--ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | what stays on screen: panels, height, width, colour |
| `--ease-enter` | `cubic-bezier(0.16, 1, 0.3, 1)` | what appears |
| `--ease-exit` | `cubic-bezier(0.4, 0, 1, 1)` | what leaves the screen |
| `--ease-pulse` | `cubic-bezier(0.37, 0, 0.63, 1)` | a pulse, there and back, never resting at either end |
| `--motion-scale` | 0.96 | what grows as it appears |
| `--motion-shift-sm`, `--motion-shift-md` | 2 px, 8 px | what rises as it appears |

### What moves

| Element | Opens | Closes | How |
|---|---|---|---|
| Hover | 100 | 100 | colour only |
| The button of a side panel under the pointer: Toggle sidebar, Show inspector, Close inspector | 100 | 100 | besides the colour, the line of its icon, the panel's edge, moves the way the panel will go: 1 px towards the frame when the panel will close, 2 px away from it when it will open; whole pixels, so the line stays sharp (`panelLine` in `motion.module.css`). Only under the pointer, not on keyboard focus. After a click on Toggle sidebar the line rests until the pointer leaves, rather than show the way back at once. Still with reduced motion |
| A highlighted speaker: turns, rows, talk time | 100 | 100 | colour only, as hover, after `--delay-hover` under the pointer; the waveform changes at once |
| Tooltip | 100 | 100 | fade and 2 px; the next within 300 ms and one from the keyboard come at once |
| Tooltip of a group, to the next control | 100 | — | the block stays, its arrow moves to the next control and its width to the new text; the text changes at once |
| Menu, popup | 150 | 100 | fade and scale from where it hangs |
| Modal and scrim | 200 | 150 | fade and scale; Choose speaker and New speaker turn into each other with neither. The strip of the window buttons dims with the scrim, on the same curves: see [Window and Editor shell](overview.md#window-and-editor-shell) |
| Toast | 200 | 150 | fade and 8 px up |
| Panel, on its button | 250 | 250 | the frame moves, the text wraps on every frame, the panel's content fades |
| What opens in place | 200 | 150 | height and fade: Show N more, speaker rows that fit or no longer fit, Disclosure, the text of a review card, a file added to the import dialog (it goes at once) |
| Review dock: the card, Close review, Resume | 250 | 250 | height and fade, as far and as long as a panel |
| Show inspector | 200 | 150 | from 8 px to the side the inspector leaves to, on the panel's curve from a fifth of its way, so that both settle in the same frame; as the inspector opens it goes back the same way, fading and shrinking 8 px towards that side, and takes no click on the way. Its room opens and closes on the panel's move (250 ms), so Speakers and Settings slide aside rather than jump; with reduced motion the room is there or not at once |
| Bubble of the player | 100 | 100 | width, when the text has changed it |
| Text being worked on: the running job's title and status | — | — | a lighter band crosses it, then it rests, over and over (`shimmer.module.css`, over the element's `--shimmer-color`, primary text unless set); plain in that colour with reduced motion |
| The live dot of a recording | — | — | its opacity breathes, never its size: a 6 px dot that scales lands on half pixels (`live.module.css`); still with reduced motion |
| Stop on the recording's row | 150 | 150 | its room opens as the time moves aside, and it fades and slides in 2 px |

Pressed and the focus ring change at once. So do the text and data of the transcript, the playhead and the waveform, scrolling, changing recording, tabs and editing a paragraph.

### How it is built

- `ui/src/styles/motion.module.css` holds the rules, taken with `composes`. A component sets `--motion-in`, `--motion-out`, `--motion-from-scale`, `--motion-to-scale` and `--motion-from-shift`. Scale and shift use the `scale` and `translate` properties, which do not fight the `transform` that centres a modal or that Radix positions with.
- Radix keeps an element until the animation of `data-state="closed"` has ended. What is shown for a value of state needs that value until then: `useLingering()` in `ui/src/presence.tsx` keeps it, and `ExitSignal` inside the element says when it is gone.
- `Collapse` and `Disclosure` take their height from Radix, with no measuring of their own. Radix measures the content as it would be on its own, so a block that the layout squeezes, such as the review dock in a low inspector, would grow past its place and jump back at the end. `Reveal` is for such content: it moves on grid rows (`0fr` to `1fr`), which reach the height the layout gives, and on the way the content keeps the size it has at the end it comes from or goes to, cut at the bottom rather than squeezed. The review dock and the text of a review card use it. It keeps its content until the way out is over.
- Waits that a script keeps, as the delay of a highlighted speaker or of a tooltip, come from the same tokens: `ui/src/styles/motion.ts` reads them from `tokens.css`.
- `appear` in `motion.module.css` plays the way in of something that is simply mounted, with no state to play out, as the Show inspector button. `--motion-delay` holds it back: that button answers no click of its own, and come at once it would be over before the eye gets there. It ends with the panel's move. `disappear` plays its way back: the component keeps it, inert, until its animations have finished, and drops it at once where nothing animates.
- `EditorScreen` always has three columns, because the number of columns cannot animate, and a closed panel's column has no width. The move is marked with `data-moving` on the element, not in state, so its end renders nothing. The text of the centre wraps again on every frame, as in native apps: on a three-hour recording that is under 2 ms of layout a frame. Wrapping once for the width it is heading for was tried and dropped: the text jumped on the first frame and was cut off by the frame or left a gap beside it. A window being resized follows at once.

### Long recordings

Nothing may walk the rows of a transcript and read their layout. `getBoundingClientRect` on a turn hidden by `content-visibility` lays it out: over a three-hour recording that takes hundreds of milliseconds. Storybook's highlight module does this on any change of the page, so measure a long recording in the app or on Vite with fixtures, not in Storybook.

### Reduced motion

The system setting empties the distance tokens in `tokens.css`, so what fades still fades. What opens in place only fades, the bubble and a tooltip passing to its neighbour change at once, panels do not move and the bar of the playing segment stands whole. The spinner keeps turning: it reports a process. The glint on text being worked on stops, as the text says the same without it, and so does the breath of the live dot: a pulse that never ends is not a fade. There is no setting for this in the app.

## Overlays

`Tooltip`, `Menu`, `Select`, `Toolbar`, `Toast`, `ScrollFade`, `Modal`, `ModalHeader`, `ModalBody` and `ModalFooter`, in `ui/src/components/`. Tooltips, menus, toolbars, toasts and modals are built on Radix Primitives. `OverlayProvider` wraps the app in `ui/src/main.tsx` and every story in `ui/.storybook/preview.tsx`: it holds the tooltip timing and the one `Toaster`.

### Layers

`--z-modal`, `--z-popover` and `--z-toast` in `tokens.css`, in that order, so a menu or a tooltip opens over a modal and a toast stays over everything. A toast stays clickable over a modal, also one that was open before the modal: Radix sets `pointer-events: none` on the body and on the layers under the modal, and `Toast.module.css` overrides that.

The topmost layer takes Escape, except a toast: with a modal open, Escape closes the modal on top, and the toast stays until it goes by itself or by its close button. Radix makes a toast a dismissable layer too, so one that shows over a modal would be the top layer and take Escape from it. Each open `Modal` is held in `ui/src/components/Modal/open-modals.ts` in the order it opened, with its way to close, and the toast's `onEscapeKeyDown` closes the last one there (`closeTopModal()`) instead of itself. Without a modal Escape closes the toast.

### Tooltip

`placement` is `above`, `below` or `none`, which has no arrow and shows above. Without room on the chosen side it takes the other one. A pointer waits 300 ms (`--delay-tooltip`), the next tooltip within 300 ms (`--delay-tooltip-skip`) shows at once, and keyboard focus shows it at once. Focus given back to a control, as a modal or a menu does on closing, shows no tooltip: the pointer is no longer on the control, so the tooltip would stay until focus moves on. Coming back to the control with Tab shows it as always. The text is a string. Other props go to the trigger, so a menu can open from a control with a tooltip.

#### Neighbours share one tooltip

Controls that stand next to each other in one row, each with a tooltip, go into a `TooltipGroup`. Its child is the row itself, an element whose box covers the gaps between the controls:

```tsx
<TooltipGroup>
  <span className={styles.nav}>
    <Tool icon="arrow-left" label="Back" />
    <Tool icon="arrow-right" label="Forward" />
  </span>
</TooltipGroup>
```

Every `Toolbar` is a group by itself. The Editor has groups for the window buttons on each side of the title bar, the transport and the speed and volume of the player, and the segments of talk time.

In a group there is one tooltip. Moving to the next control, the block stays where it is and its arrow moves to the new control in 100 ms on `--ease-standard`, while the block's width follows the new text from its middle. The block moves only as far as it must to keep the arrow under it and itself in the window, and up or down to a control of another size, as Play in the player. The text changes at once and shows only over the block as it grows. The next tooltip of a group comes at once, however long the last one was shown, and keyboard focus passes the same way. Over the gaps the tooltip stays; it goes as any other once the pointer leaves the group. One that would turn over to the other side of its control changes at once, with no travel.

Each control keeps its own Radix tooltip, so `role="tooltip"` and `aria-describedby` are as for a single one. In a group the tooltips are opened by the group, not by Radix alone: one stays open until the next is placed, then hides in that frame, and the next starts from where the last stood. Radix places a tooltip twice, the second time lower by the height of its arrow, so the height of the next one is worked out from the controls, not from where Radix first put it. A group's row in the title bar is not for dragging the window: over a drag region the pointer leaves the page, and the tooltip would go.

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

`ContextMenu` is the same menu at the pointer, opened by the `contextmenu` event of its target (`content` holds the items, the target is its child): a right click, the Menu key or Shift+F10, where Chromium places it at the focused element and the first item takes the focus. The items above work in both: each takes the Radix parts of the menu it is in. `disabled` keeps the target and its menu mounted and opens nothing, so the browser's own menu shows instead, as in a text field put in the target's place. Built on `@radix-ui/react-context-menu`.

### Select

`Select` is one value of a short list in a field that looks like `TextField`, with its label above it. It is a Radix Select with the surface and rows of `Menu`, and the list is as wide as the field. An option can be off with a reason at the end of its row (`meta`), such as "Not installed"; a value that is none of the options shows `placeholder`. It is read as a native select: the field is a `combobox` named by its label, or its `aria-label`, with the chosen option as its text; the list is a `listbox` of the same name, and each row an `option` named by its label and its `meta`. The keyboard opens the list on the chosen option and skips the ones that are off; Escape closes it and returns to the field. The field rings while its list is open and in keyboard focus, as a button does; focus from a click, or given to it as the first control of a window, shows no ring, unlike a text field, which rings whenever it has the focus. While the list is open, the rest of the window is hidden from assistive technology and its scroll is held, as for a modal.

Inside a `Modal` the list does not go past the window: `Modal` hands its window to popups as their boundary (`useModal().boundary`), and the list opens upwards when there is more room there and scrolls when it fits neither way. Outside a modal the boundary is the viewport.

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

`ModalHeader` keeps its icon and the close button on the line of the title, also when a description stands under it.

`ModalFooter` takes the colour of Confirm from the type of the modal. `cancel` is by default a Cancel that closes; given an `onClick`, it does that and stays open, as Back does; `null` leaves it out.

Tab stays inside, and Escape, the scrim, Cancel and the close button close. Focus starts on the first control of the body, then the footer, never on the close button first. A window opened by a click or by files dragged over the window starts there without the focus ring, which shows from the first key; one opened from the keyboard shows it at once. Chromium would take that focus, given by a script, for a keyboard one, and a drag is no pointer input to it. A danger modal has the `alertdialog` role and starts on Cancel, so that an Enter pressed too soon deletes nothing. It is not a Radix AlertDialog, which would not close on the scrim. On closing, focus returns to what was focused before, and for a window opened from a menu, to the menu's button, without showing its tooltip (`returnFocus` from `Tooltip`). When that is gone by then, such as the row of a deleted model or a dialog that closed to open this one, focus goes to the window still open under it. A window opened over another one, such as a confirmation over Settings, is a layer of its own: Escape, its scrim and Cancel close only it. Its scrim dims the window under it again; `scrim="clear"` leaves the dimming to the scrim already there. `scrim="auto"` is clear when another window is open under it and dims when it opens alone, for a window opened from anywhere, as Settings. A window opened over another from elsewhere in the page, not from inside it, does not close the one under it by taking the focus.

`ui/src/components/Modal/open-modals.ts` counts the open windows: each one from when it opens to when it is told to close, not during its way out. `openModalCount()` and `useOpenModalCount()` let what opens a window by itself, a drag of files or a failed job, wait while another is open.

`preview` draws the window in place, without scrim and focus trap, for a board of variants in a story.

### Unimplemented controls

A control whose feature does not exist yet is not hidden and does not pretend to work. `ui/src/not-implemented.ts` marks it where it is rendered:

```tsx
<Button {...markNotImplemented('titlebar.share')}>Share</Button>
```

The control stays visible and focusable, dimmed with `--opacity-disabled`, with the default cursor and `aria-disabled`. Activating it shows "Not available yet" and reaches none of its handlers, nor those of the controls inside a marked container.

The function returns props instead of relying on a global click guard, because Radix does not wait for a click: tabs switch on mousedown and on focus, menus act on pointerup and on the keydown of Enter and Space, and a select or a menu button opens on ArrowDown and ArrowUp. Capture handlers stop all of these; the arrows only on a control that opens a popup, so that they still move past a marked tab.

`NOT_IMPLEMENTED` lists the ids, and an id that is not in it is a compile error. `not-implemented.test.tsx` fails when an id has no call or several, when a call has no id or a computed one, and on a control's own "not available" text; stories and tests do not count. The list holds only what the UI already renders. Stories use `notImplementedProps()`, which takes any string.

This differs from a disabled control, which ignores the press with no word (Start recording while a recording runs). When a feature lands, its id leaves `NOT_IMPLEMENTED` together with the call at its control; the test fails if only one of the two goes.

## Design decisions

These hold on every screen of the UI, not only on the one where they were settled.

### Source of truth

The code and Storybook are the design. The Penpot boards the Editor was built from are a frozen archive: they are read for reference and as an inventory of states, never edited to follow the app, and the app is not changed to follow them. Screens after the Editor are designed directly in code. Alternatives are shown side by side as Storybook variants or on a stand with the real component, and judged in the running app: motion, delays and hover can only be judged there.

### Accepted differences from the Editor boards

Where a board contradicts itself or an older board contradicts a later decision, the app follows the rule, not the picture. These differences are intended; do not "fix" them back:

1. A recording shows the New dot until it is opened, not while it has a speaker with no name ([Window and Editor shell](overview.md#window-and-editor-shell)).
2. The recording Design review shows the avatars its data gives (LK and two unknown), not those of the board.
3. A text field has no glow around it in focus.
4. Renaming a recording selects the whole title.
5. The Unassigned time in the inspector is worked out from the segments.
6. Under Show N more the hidden speakers are the recording's own, not a grey unknown one.
7. A review card's clip stands at its start.
8. Other speakers are sorted by name, as the API gives them.
9. Every section heading has 4 px under it.
10. A filled search field shows a clear button.
11. A new speaker's default colour is the least used one.

The player also keeps unknown speakers grey on the waveform and its speed button 44 px wide; sidebar rows show at most three avatars with no count of the others.

### Rules settled on the Editor

- Type scale 11, 13, 15, 18 and 22 px, weights 400 and 600 only, through the `--font-*` tokens.
- No `·` separators and no all-caps labels: separate values are separate elements with a gap, a list inside a phrase uses commas, a number next to a title is a counter. Straight quotes. All text in the UI and in stories is English.
- An ellipsis means one of two things: something is in progress (Transcribing audio…, Checking models…, Cancelling…), or a long name is cut by `text-overflow: ellipsis` where it does not fit. Commands never get one, in menus, on buttons or in tooltips, even when they open a dialog or a file picker: Change speaker, Import files, Transcription settings. It is always the single character `…`, never three dots.
- A control whose feature does not exist yet stays visible with the default cursor ([Unimplemented controls](#unimplemented-controls)); it is never hidden or faked.
- Secondary actions of a row, such as Play and Assign on a speaker, appear on hover and focus of that row. A gap between hover targets is covered by a hit area, not by a timer, so the highlight does not drop between rows.
- Delays and durations in scripts come from the tokens through `ui/src/styles/motion.ts`, never as literals. A highlight under the pointer waits `--delay-hover`, the next one comes at once.
- Neighbouring controls with tooltips share one tooltip through `TooltipGroup`; a `Toolbar` always is one.
- A control at the top edge of a window or a panel, as in the title bar, the transcript header or the inspector, shows its tooltip below it (`placement="below"`); the default is above.
- A scroll area shows its own `ScrollBar`; system scrollbars are off.
- A delete prompt has no icon; a danger modal starts on Cancel.
- Content stays where it is when something about it changes: a paragraph does not move when its speaker changes, and widths of clocks and counters do not change while they count.
- A design system component gets its full set of states (Default, Hover, Pressed, Focus, Disabled, and Loading, Error or Selected where they apply), not only the ones the current screen uses.
