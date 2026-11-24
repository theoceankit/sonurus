import type { NoteQuote } from '../../components/NoteEditor/note-content'

// Who a turn's speaker is to a note: by id, with the label the transcript shows. An
// unknown speaker reads as that label until they get a name. A recording without
// speakers has none.
export type QuoteSpeaker = (id: string) => NoteQuote['speaker']

// The selected text as quotes, one for each turn it touches: the speaker, the start
// of the first paragraph touched and the words selected in that turn. Blocks of one
// turn next to each other (a recording without speakers is drawn in blocks) are one.
export function selectionQuotes(range: Range, list: Element, speakerOf: QuoteSpeaker): NoteQuote[] {
  const quotes: (NoteQuote & { turn: string })[] = []
  for (const quote of turnQuotes(range, list, speakerOf)) {
    const last = quotes.at(-1)
    if (last && last.turn === quote.turn) last.text = `${last.text} ${quote.text}`
    else quotes.push(quote)
  }
  return quotes.map(({ turn: _turn, ...quote }) => quote)
}

function turnQuotes(range: Range, list: Element, speakerOf: QuoteSpeaker) {
  return [...list.querySelectorAll<HTMLElement>('[data-speaker]')].flatMap(turn => {
    if (!range.intersectsNode(turn)) return []
    const paragraphs = [...turn.querySelectorAll<HTMLElement>('[data-segment-start]')].filter(paragraph => range.intersectsNode(paragraph))
    const pieces = paragraphs.flatMap(paragraph => {
      const text = paragraph.querySelector('[data-transcript-text]')
      if (!text) return []
      const part = document.createRange()
      part.selectNodeContents(text)
      if (range.compareBoundaryPoints(Range.START_TO_START, part) > 0) part.setStart(range.startContainer, range.startOffset)
      if (range.compareBoundaryPoints(Range.END_TO_END, part) < 0) part.setEnd(range.endContainer, range.endOffset)
      const words = part.toString().trim()
      return words ? [{ start: Number(paragraph.dataset.segmentStart), words }] : []
    })
    if (pieces.length === 0) return []
    return [{ turn: turn.dataset.speaker!, speaker: speakerOf(turn.dataset.speaker!), start: pieces[0].start, text: pieces.map(piece => piece.words).join(' ') }]
  })
}
