import { afterEach, beforeAll, afterAll } from '@jest/globals'

afterEach(() => {
  jest.clearAllMocks()
})

const origError = console.error
beforeAll(() => {
  console.error = (...args: any[]) => {
    origError(...args)
    throw new Error('Unexpected console.error: ' + args.join(' '))
  }
})
afterAll(() => {
  console.error = origError
})
  
export function enoent(msg = 'no file') {
  const err: any = new Error(msg)
  err.code = 'ENOENT'
  return err
}
