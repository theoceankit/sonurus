import { describe, expect, test } from 'vitest'
import { ApiError } from '../../api/client'
import { HANDLE_RULE, handleProblem, isHandleRefusal, normalizeHandle, typedHandle } from './handles'

const OTHERS = [{ name: 'Ivan Petrov', handle: 'ivan.petrov' }, { name: null, handle: null }]

describe('handleProblem', () => {
  test('a free handle is fine, typed with an @ and capitals too', () => {
    expect(handleProblem('vanya', OTHERS)).toBeUndefined()
    expect(handleProblem(' @Vanya ', OTHERS)).toBeUndefined()
  })

  test('a handle of another speaker, in any case, names them', () => {
    expect(handleProblem('IVAN.PETROV', OTHERS)).toBe('@ivan.petrov is taken by Ivan Petrov.')
  })

  test.each(['', '@', '.ivan', 'ivan petrov', 'иван', 'a'.repeat(33)])('%j is not a handle', text => {
    expect(handleProblem(text, OTHERS)).toBe(HANDLE_RULE)
  })
})

test('normalizeHandle and typedHandle', () => {
  expect(normalizeHandle('  @@Ivan.P ')).toBe('ivan.p')
  expect(typedHandle('@Ivan.P')).toBe('ivan.p')
  expect(typedHandle('Ivan ')).toBe('ivan ')
})

test('isHandleRefusal', () => {
  expect(isHandleRefusal(new ApiError(409, 'taken', 'handle_taken'))).toBe(true)
  expect(isHandleRefusal(new ApiError(409, 'busy', 'job_running'))).toBe(false)
  expect(isHandleRefusal(new Error('x'))).toBe(false)
})
