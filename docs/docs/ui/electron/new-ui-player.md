---
sidebar_position: 5
---

# New UI player

The player panel of the Editor in the new UI. Playback is kept apart from the components that draw it, so anything that follows the audio can subscribe to it on its own.

```
EditorPlayer (ui/src/screens/Editor/) → Player → Waveform, Playhead, VolumeControl → Slider
     ↑                                     ↑ state and callbacks in props
EditorScreen: useTranscriptPlayback() → useAudioPlayback(url) → Playback (ui/src/media/playback.ts) → one audio element
```

## Playback

`createPlayback()` holds one audio element and a state: `currentTime`, `duration`, `paused`, `rate`, `volume` and `status`, which is `empty`, `loading`, `ready` or `error`.

- `useAudioPlayback(src)` makes one for a component's lifetime and loads `src`. The same element stays when the source changes, so speed and volume stay when another recording opens. Neither is remembered between runs.
- `usePlayback(playback, selector)` renders only when what the selector returns changes. The time changes about four times a second, so something that needs less, such as the active segment, selects just that.

`ui/src/media/timeline.ts` has the pure logic: the clock (`00:35`, from one hour on `1:02:05`), `activeSegmentIndex()`, jumps between speakers and which turn each bar belongs to. It works on turns (`Turn`), a segment with its speaker's name and colour.

## Components

`Player` only draws and reports: it gets the state and the turns and calls back with what to do. Every state is therefore a story, and `initialCursor` shows the cursor over the waveform without a mouse. `EditorPlayer` connects it to the open recording, on the playback the screen holds, which the transcript follows too. The player is disabled until the audio is `ready`, so with no recording, no audio or audio that failed to load; the bars then take their length from the segments. A recording with nothing to play has `Audio file not found` over the bars (the `notice` prop), unless the backend is what is away.

A live recording in WebM has no duration in the file, so the audio element says Infinity. The length is then the end of the last segment, for the bars and the clock alike, and the playhead stops at the end of the waveform if the audio goes on.

`Waveform` has two sizes:

| Size | Bars | Played | The rest |
|---|---|---|---|
| Large | 120, narrower with the panel | `speaker-N-mid` | `speaker-N-bg` |
| Small | 26, of fixed width | `text-primary` | `speaker-6-mid` |

Large colours bars by speaker. A speaker without a name and Unassigned are `speaker-6`, as on their avatars, and a pause is `border-default` whether played or not. The heights are decorative and come from the Penpot boards; the `heights` prop takes others. Small knows nothing of speakers and takes only `progress`, for a clip.

`Playhead` is drawn inside the element that holds the waveform. The default look is the line and the knob at the current time. The hover look is the line and a bubble with the time and the speaker's name. The bubble changes width over 100 ms when another speaker or the hour changes the text; the width is read only then, and the position follows the pointer at once.

## Behaviour

- The cursor over the waveform shows a second playhead in the hover look and lights up the turn under it; the real playhead stays where it is.
- Pressing seeks, and dragging keeps seeking. While dragging, the only playhead is in the hover look.
- The waveform is a `role="slider"`: the arrow keys move by 5 seconds, Home and End go to the ends.
- Previous and next speaker go to the start of the neighbouring run of one speaker, and do nothing at the ends. A pause belongs to the run before it.
- The speed button opens a list above it: 0.5, 1, 1.2, 1.5 and 2. The button has a fixed width, wider than on the board, so the waveform stays in place.
- Volume 0 mutes and dims the button. There is no separate mute.

The bubble stands above the panel, so the player panel in `EditorScreen.module.css` does not clip.
