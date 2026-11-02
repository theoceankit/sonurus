import { describe, expect, test } from 'vitest'
import { closeReview, openReview, resumeReview, reviewView, selectSpeaker, skipSpeaker } from './review-queue'

const ALL = ['a', 'b', 'c', 'd']

describe('opening', () => {
  test('starts on the first, with the card open', () => {
    expect(reviewView(openReview(ALL), ALL)).toEqual({ currentId: 'a', position: 1, total: 4, left: 4, mode: 'on' })
  })

  test('nobody to review', () => {
    expect(reviewView(openReview([]), [])).toEqual({ currentId: null, position: 0, total: 0, left: 0, mode: 'off' })
  })

  test('can start on a given speaker', () => {
    expect(reviewView(openReview(ALL, 'c'), ALL)).toMatchObject({ currentId: 'c', position: 3 })
  })
})

describe('skip', () => {
  test('goes to the next, and from the last around to the first', () => {
    let state = openReview(ALL)
    state = skipSpeaker(state, ALL)
    expect(reviewView(state, ALL)).toMatchObject({ currentId: 'b', position: 2, left: 4 })
    state = skipSpeaker(skipSpeaker(skipSpeaker(state, ALL), ALL), ALL)
    expect(reviewView(state, ALL)).toMatchObject({ currentId: 'a', position: 1 })
  })

  test('passes over those already assigned', () => {
    const pending = ['a', 'c']
    expect(reviewView(skipSpeaker(openReview(ALL), pending), pending)).toMatchObject({ currentId: 'c', position: 3, left: 2 })
  })

  test('the only one left stays', () => {
    expect(reviewView(skipSpeaker(openReview(['a']), ['a']), ['a']).currentId).toBe('a')
  })
})

describe('assigning', () => {
  test('goes on to the next by itself, the position stays among all', () => {
    expect(reviewView(openReview(ALL), ['b', 'c', 'd'])).toEqual({ currentId: 'b', position: 2, total: 4, left: 3, mode: 'on' })
  })

  test('from the last goes around to one that was skipped', () => {
    const state = selectSpeaker(openReview(ALL), 'd')
    expect(reviewView(state, ['a', 'b'])).toMatchObject({ currentId: 'a', position: 1, left: 2 })
  })

  test('nobody left ends the review', () => {
    expect(reviewView(openReview(ALL), [])).toEqual({ currentId: null, position: 0, total: 4, left: 0, mode: 'off' })
  })
})

describe('undo', () => {
  test('shows that speaker again', () => {
    const state = selectSpeaker(openReview(ALL), 'a')
    expect(reviewView(state, ALL)).toMatchObject({ currentId: 'a', position: 1, left: 4, mode: 'on' })
  })

  test('after the last assignment brings the review back', () => {
    const state = selectSpeaker(openReview(['a']), 'a')
    expect(reviewView(state, [])).toMatchObject({ mode: 'off' })
    expect(reviewView(state, ['a'])).toMatchObject({ currentId: 'a', mode: 'on' })
  })

  test('opens the card if it was closed', () => {
    expect(reviewView(selectSpeaker(closeReview(openReview(ALL)), 'b'), ALL)).toMatchObject({ currentId: 'b', mode: 'on' })
  })
})

describe('close and resume', () => {
  test('close collapses and keeps the count', () => {
    expect(reviewView(closeReview(openReview(ALL)), ALL)).toMatchObject({ mode: 'collapsed', left: 4 })
  })

  test('resume opens on the next speaker', () => {
    expect(reviewView(resumeReview(closeReview(openReview(ALL)), ALL), ALL)).toMatchObject({ currentId: 'b', mode: 'on' })
  })

  test('resume with one left opens on it', () => {
    expect(reviewView(resumeReview(closeReview(openReview(['a'])), ['a']), ['a'])).toMatchObject({ currentId: 'a', mode: 'on' })
  })

  test('closed with nobody left is off', () => {
    expect(reviewView(closeReview(openReview(ALL)), []).mode).toBe('off')
  })
})

test('a speaker that turns up later goes to the end', () => {
  const pending = [...ALL, 'e']
  expect(reviewView(openReview(ALL), pending)).toMatchObject({ currentId: 'a', total: 5, left: 5 })
})
