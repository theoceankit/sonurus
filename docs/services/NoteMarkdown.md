---
sidebar_position: 15
---

# Note Markdown

`app/services/note_markdown.py` turns the note of a recording into Markdown and Markdown back into a note, for tools that read and write notes as text. The note itself stays the editor's document ([Data Models → Note](../data-models.md#note)); Markdown is only how it is shown and taken in.

Pure functions: no database, no network. The caller passes what it knows about speakers as `NoteSpeakers`: the speakers of the base (`id`, `name`, `handle`) and the labels of the speakers of this recording who have no name yet, `{id: "Unknown speaker 2"}`, as the editor shows them.

Parsing is done by [markdown-it-py](https://markdown-it-py.readthedocs.io) (CommonMark) with rules of its own for timecodes, mentions and addresses written out.

---

## Functions

### `note_to_markdown(doc, speakers) → str`

The note as Markdown. A note with nothing in it is an empty string. Raises `ValueError` for anything but a document of type `doc`.

### `markdown_to_note(text, speakers) → NoteFromMarkdown`

`doc` is the note as the editor would save it, with every attribute the editor gives its nodes. `warnings` says in English what was made simpler, one line for each kind. Markdown is never refused. Empty Markdown is an empty note, a document with one empty paragraph.

### `normalize(doc, speakers) → dict`

The note as it reads back from its Markdown (see [Without loss](#without-loss)). Both functions above go through it.

---

## The format

| In the note | In Markdown |
|---|---|
| Heading 1–3 | `#`, `##`, `###` |
| List, numbered list | `-`, `1.` (the first number kept) |
| Checkbox | `- [ ]`, `- [x]` |
| Quote | `>` on every line, `>` alone on an empty one |
| Bold, italic, link | `**bold**`, `*italic*`, `[text](address)`; a link whose text is its `http(s)` address is the address alone |
| Line break in a paragraph | `\` at the end of the line |
| Timecode | `[12:34]`, `[1:02:03]` from an hour on |
| Speaker of the base | `@handle` |
| Someone not in the base | `@[Sam from support]` |
| Speaker of this recording without a name yet | `@[Unknown speaker 2]` |
| Empty paragraph | One more empty line between blocks |

Blocks are one empty line apart. A list right under the text of its item has no empty line before it. A list right after a list of the same kind takes the other marker (`*`, `1)`), or Markdown would read the two as one.

Text that would read as markup is escaped with a backslash: `\*`, `\_`, `\[12:34\]`, `\@anna`, `\<tag>`, `\#` or `1\.` at the start of a line, `https\://` and `www\.` for an address that is text and not a link.

### Mentions

A mention is `@` at the start of a word: in `anna@example.com` it is text. `@handle` finds a named speaker by handle, in any case; punctuation after it (`@anna.`) is not part of it. A handle no speaker has stays text, and the warning lists it: `Unknown handles kept as text: @petya.`

`@[Name]` is someone not in the base, as Mention "…" makes in the editor, unless the name is the label of a speaker of this recording without a name, who it then mentions by id. So a quote of such a speaker keeps pointing at them, and becomes a chip with their name once they have one. A speaker the note mentions who is gone from the base, or has no name and is not in this recording, is written as the name last seen, in text.

### What the note does not have

| Markdown | Becomes | Warning |
|---|---|---|
| `####` to `######` | Heading 3 | Headings below level 3 became level 3. |
| `` `code` `` | Text | Inline code became plain text. |
| Code block | A paragraph, its lines kept | Code blocks became plain text. |
| `~~strike~~` | Text | Strikethrough was removed. |
| `![alt](src)` | A link to `src` with the text `alt` | Images became links. |
| Table | A paragraph per row, cells joined by ` \| ` | Tables became plain text. |
| `---` | Nothing | Horizontal rules were removed. |
| HTML | Text as written | HTML was kept as text. |

Other ways of writing what the note has are taken as they are: `_italic_`, `__bold__`, `*` and `+` lists, `1)`, `<https://…>`, reference links, setext headings, two spaces at the end of a line, a line of a paragraph continued without `>`. An address written out (`https://…`, `www.…`) becomes a link, as it does when typed in the editor; an address of mail written out does not.

---

## Without loss

A note → Markdown → note is the same note in its normal form, and Markdown written by `note_to_markdown()` → note → Markdown is the same text. The normal form:

- links and mentions with the attributes the editor gives them; marks in the editor's order;
- a speaker's mention with the name they have now;
- a timecode on a whole second (a quote's starts at the start of its segment, a fraction past it);
- no spaces at the edges of a paragraph, of a line, or of bold, italic or a link (moved out of the mark);
- no line break at the end of a paragraph; a line break in a heading is a space;
- empty paragraphs at the end of the last item of a list are after the list; an item with nothing on its first line goes straight on to its next block; a quote of nothing but empty lines has one;
- one text node for each run of the same marks.

CommonMark cannot write everything: bold or italic that starts or ends between a letter and a punctuation mark (`word**(x)**`), or right against another mark with no space, and a mention with a letter right before or after it, may read back as text. Notes written in the editor rarely have them.

---

## Fixtures shared with the editor

The note's schema is defined in the UI (`ui/src/components/NoteEditor/`); this module writes the same documents. `tests/fixtures/notes/` keeps both on one schema:

- `<case>.json` and `<case>.md`: a note and its Markdown, each turning into the other;
- `<case>.input.json`: a note that becomes `<case>.md`, `<case>.json` being its normal form;
- `<case>.input.md` and `<case>.warnings.json`: Markdown as an agent may write it, which becomes `<case>.json` with those warnings;
- `speakers.json`: the speakers they mention.

`ui/src/components/NoteEditor/note-fixtures.test.tsx` loads every document into the real `NoteEditor` and expects it to save exactly that document, so a change to the editor's nodes or attributes fails there until the fixtures, and this module, follow. `NOTE_FIXTURES=write npm --prefix ui test -- note-fixtures` rewrites them from the editor. `minutes.input.json` is the story note of `note-samples.ts`. `tests/test_note_markdown.py` checks this module against every case.
