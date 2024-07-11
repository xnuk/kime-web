import { writeFile, readFile, appendFile, mkdir } from 'node:fs/promises'
import { watch } from 'node:fs'

export const readTextFile = (path: URL | string): Promise<string> =>
	readFile(path, 'utf8')
export const writeTextFile = (path: URL, content: string): Promise<void> =>
	writeFile(path, content, 'utf8')
export const appendTextFile = (path: URL, content: string): Promise<void> =>
	appendFile(path, content, 'utf8')

export const mkdirRecursive = (path: string | URL): Promise<void> =>
	mkdir(path, { recursive: true }).then(() => {})

export const watchDir = (path: URL, callback: () => void): (() => void) => {
	const aborter = new AbortController()
	watch(path, { recursive: true, signal: aborter.signal }, callback)
	return () => aborter.abort()
}

export {
	writeFile,
	readFile,
	appendFile,
	realpath as realPath,
} from 'node:fs/promises'

export { isAbsolute, join as pathJoin, dirname } from 'node:path'
