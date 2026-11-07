---
sidebar_position: 11
---

# New UI settings

Settings in the new UI (`ui/src/screens/Settings/`) are one large modal with the sections in a column at its side. They apply as they change: there is nothing to save, and the window only closes. The old UI keeps its own Settings screen; both read and write the same `settings.json` ([Electron overview](overview.md#settings)).

## Opening

`SettingsProvider`, around the screens in `App`, holds the one Settings window of the app. `useSettingsDialog().open(section?)` opens it on a section, the first one by default. It opens from:

- the Settings button of the titlebar;
- Settings in the line of the empty state ([New UI home](new-ui-home.md#without-recordings));
- Download in Settings and Open Settings in the New transcription dialog, and Open Settings in the failed state of the Alignment model dialog ([New UI transcription](new-ui-transcribe.md)). These close their dialog first, as the old UI left the dialog for its Settings screen.

Without a provider, as for a screen alone in a story or a test, `open` does nothing.

`SettingsDialog` is `Modal size="large"` with `Tabs orientation="vertical"`: a `NavTab` per section, the version line under them (`formatAppVersion` of `getAppVersion()`: "Sonorus 0.3.0", "Sonorus" alone without a version) and the panel of the section next to them. The window keeps one height (`--size-settings-height`) whatever the section, down to what a small window leaves; the panel scrolls.

## General

- **App language** is marked with `markNotImplemented()`: the interface has one language.
- **Interface scale**, 50 to 200% in steps of 5, with marks at 50, 100, 150 and 200%. The slider follows the pointer; when it lets go, or a key is released, the window zooms (`setZoom`) and `scale` is saved. The new UI applies the saved scale on start.
- **Transcription language**, `transcribeLang`, the default of new transcriptions; Detect automatically is `auto`. A language whose alignment model is not downloaded gets a notice under the row with Download and the model's size; while it downloads, the percentage and Cancel. The download is the one of the app ([New UI transcription](new-ui-transcribe.md#downloads)): it goes on when Settings close. A saved language that is not in the list, such as one picked in the old UI, is still shown, by the name of its alignment model.
- **Start transcription**, Automatically or Manually. The backend keeps it with the queue (`PUT /queue/settings`), not in `settings.json`; the field shows the value of the queue snapshot and is off until the queue has answered.
