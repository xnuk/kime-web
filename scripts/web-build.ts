import { type Plugin, context as makeContext } from 'esbuild'

import { readFile, mkdirRecursive } from './fs.ts'
import { wasmLoader } from './esbuild-wasm-plugin.ts'

const trimHtml = (html: string) =>
	html
		.trim()
		.replace(/\r?\n\s*/g, '\n')
		.replace(/>\n</g, '><')

const htmlMinifier: Plugin = {
	name: 'htmlMinifier',
	setup(build) {
		build.onLoad({ filter: /\.html$/ }, async arg => ({
			contents: trimHtml(await readFile(arg.path, 'utf8')),
			watchFiles: [arg.path],
			loader: 'copy',
		}))
	},
}

export const build = async ({
	outdir,
	port,
	minify = true,
}: {
	outdir: string
	port?: number | undefined
	minify: boolean
}): Promise<() => void> => {
	await mkdirRecursive(outdir)

	const context = await makeContext({
		plugins: [wasmLoader, htmlMinifier],
		entryPoints: ['web/index.ts', 'web/index.html'],
		bundle: true,
		outdir,
		format: 'esm',
		target: ['firefox117'],
		platform: 'browser',
		minify,
		charset: 'utf8',
		define: { SERVE: (port != null) + '' },
		assetNames: '[name]',
		loader: { '.html': 'copy' },
	})

	if (port != null) {
		const served = await context.serve({ port })
		console.log(`running at ${served.host}:${served.port}`)
		await context.watch()
		return () => context.dispose()
	}

	const result = await context.rebuild()
	const hasError = result.errors.length > 0 || result.warnings.length > 0

	for (const error of result.errors) {
		console.error(error)
	}

	for (const warn of result.warnings) {
		console.warn(warn)
	}

	await context.dispose()
	if (hasError) return Promise.reject()
	return () => {}
}
