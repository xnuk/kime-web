import { build as webBuild } from './web-build.ts'
import {
	build as wasmBuild,
	buildParams as wasmBuildParams,
} from './wasm-build.ts'
import { directoryUrl, urlToPath } from './url.ts'
import { watchDir } from './fs.ts'

const promisedDebouncer = (func: () => Promise<void>, delay: number = 300) => {
	let timeout = setTimeout(() => {})

	const run = () => {
		clearTimeout(timeout)
		timeout = setTimeout(func, delay)
	}

	return run
}

const watch = async (outdir: URL, port: number = 8080) => {
	const wasmParams = await wasmBuildParams(
		directoryUrl(outdir, 'wasm-pkg'),
		undefined,
		true,
	)

	await wasmBuild(wasmParams)

	const wasmCancel = watchDir(
		wasmParams.pkg.path,
		promisedDebouncer(async () => wasmBuild(wasmParams).catch(() => {})),
	)

	const webCancel = await webBuild({
		outdir: urlToPath(directoryUrl(outdir, 'web')),
		port,
		minify: false,
	})

	return () => (wasmCancel(), webCancel())
}

const build = async (outdir: URL) => {
	await wasmBuildParams(
		directoryUrl(outdir, 'wasm-pkg'),
		undefined,
		true,
	).then(wasmBuild)
	await webBuild({
		outdir: urlToPath(directoryUrl(outdir, 'web')),
		minify: true,
	})
}

const main = () => {
	const port = +(process.argv.slice(2).pop() || 0)
	const outdir = directoryUrl('./dist/')
	console.log('port', port)

	port > 0 ? watch(outdir, port) : build(outdir)
}

main()
