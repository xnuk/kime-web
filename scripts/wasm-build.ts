import { urlToPath, directoryUrl, fileUrl } from './url.ts'
import { Runner } from './runner.ts'
import { writeTextFile, readTextFile, appendTextFile } from './fs.ts'

const lastSplitOnce = (
	source: string,
	delimiter: string,
): readonly [string, string] | null => {
	const rindex = source.lastIndexOf(delimiter)
	if (rindex === -1) return null

	return [
		source.substring(0, rindex),
		source.substring(rindex + delimiter.length),
	] as const
}

const TRIPLE = 'wasm32-unknown-unknown'

type Pkg = {
	id: string
	name: string
	version: string
	license: string | null
	path: URL
}

type Params = {
	runner: ReturnType<typeof Runner>
	cargoTargetDir: URL
	pkg: Pkg
	outDir: URL
	verbose: boolean
}

type CargoMetadata = {
	packages: {
		name: string
		version: string
		id: string
		license: string | null
		description: string | null
		dependencies: {
			name: string
			source: string
			optional: boolean
			req: string
		}[]
		targets: {
			kind: string[]
			crate_types: string[]
			name: string
			edition: string
			doc: boolean
		}[]
		manifest_path: string
		rust_version: string
		edition: string
	}[]
	workspace_members: string[]
	workspace_default_members: string[]
	target_directory: string
	version: 1
	workspace_root: string
}

const cargoMetadata = async () => {
	const metadata = JSON.parse(
		await Runner({
			cwd: new URL('.', import.meta.url),
			shell: false,
		})
			.read(
				'cargo',
				'metadata',
				'--format-version=1',
				'--filter-platform=' + TRIPLE,
				'--offline',
				'--frozen',
				'--no-deps',
			)
			.then(v => v.text()),
	) as CargoMetadata

	const { workspace_members, workspace_root, packages, target_directory } =
		metadata

	const candidates = packages
		.filter(
			pkg =>
				workspace_members.includes(pkg.id) &&
				pkg.targets.some(target => target.kind.includes('cdylib')) &&
				pkg.dependencies.some(dep => dep.name === 'wasm-bindgen'),
		)
		.map(
			(pkg): Pkg => ({
				id: pkg.id,
				name: pkg.name,
				version: pkg.version,
				license: pkg.license,
				path: new URL('.', fileUrl(pkg.manifest_path)),
			}),
		)

	return {
		runner: Runner({ cwd: directoryUrl(workspace_root), shell: false }),
		cargoTargetDir: directoryUrl(target_directory),
		candidates: candidates,
	} as const
}

export const buildParams = async (
	outDir: URL,
	projectName?: string,
	verbose = false,
): Promise<Params> => {
	const { cargoTargetDir, candidates, runner } = await cargoMetadata()
	let pkg = null as null | undefined | Pkg

	if (projectName != null) {
		pkg = candidates.find(v => v.name === projectName)
	} else if (candidates.length === 1) {
		pkg = candidates[0]
	}

	if (pkg == null) {
		return Promise.reject(
			new Error(`cannot find wasm project ${projectName || ''}`),
		)
	}

	return {
		runner,
		cargoTargetDir,
		pkg,
		outDir: directoryUrl(outDir),
		verbose,
	}
}

const cargoBuild = ({ runner, pkg, verbose }: Params) => {
	if (verbose) console.debug('[wasm build] cargo building ' + pkg.id)

	return runner.run(
		'cargo',
		'build',
		'--lib',
		'--target=' + TRIPLE,
		'--package=' + pkg.name,
		'--release',
		...(process.env['CI'] ? ['--locked'] : []),
	)
}

const wasmBindgen = ({
	runner,
	pkg,
	cargoTargetDir,
	outDir,
	verbose,
}: Params) => {
	if (verbose) console.debug('[wasm build] extracting glue')

	const wasmPath = new URL(
		`./${TRIPLE}/release/${pkg.name.replaceAll('-', '_')}.wasm`,
		cargoTargetDir,
	)
	return runner.run(
		'wasm-bindgen',
		'--out-dir',
		urlToPath(outDir),
		'--out-name',
		pkg.name,
		'--typescript',
		'--target=bundler',
		'--remove-name-section',
		'--remove-producers-section',
		'--omit-default-module-path',
		'--encode-into=always',
		urlToPath(wasmPath),
	)
}

const wasmOpt = async ({ runner, outDir, pkg, verbose }: Params) => {
	if (verbose) console.debug('[wasm build] optimizing wasm')
	const wasmPath = new URL(`./${pkg.name}_bg.wasm`, outDir)
	const output = await runner
		.read(
			'wasm-opt',
			'--quiet',
			'--fast-math',
			'--minify-imports-and-exports-and-modules',
			'-O',
			urlToPath(wasmPath),
			'-o',
			urlToPath(wasmPath),
		)
		.then(v => v.text())

	const renameEntries = output
		.trim()
		.split(/\n/)
		.map(v => {
			const splited = lastSplitOnce(v, ' => ')
			if (splited == null) return null
			const [original, renamed] = splited
			return [renamed.trim(), original.trim()] as const
		})
		.filter((v): v is Exclude<typeof v, null> => v != null)

	if (renameEntries.length > 0) {
		const payload = JSON.stringify(
			{
				// it's actually encoded with 'a', but wasm-opt does not print this.
				module: { a: `./${pkg.name}_bg.js` },
				functions: Object.fromEntries(renameEntries),
				version: 'xnuk-r1',
			},
			null,
			2,
		)

		const path = new URL(`./${pkg.name}_bg.wasm.renamed.json`, outDir)
		await writeTextFile(path, payload)
	}
}

const wasmBindgenModifyJs = async ({ outDir, pkg, verbose }: Params) => {
	if (verbose) console.debug('[wasm build] fixing glue')

	const path = new URL(`./${pkg.name}_bg.js`, outDir)

	// minify problem
	const content = (await readTextFile(path))
		.replace(
			/(?:^|\n)let wasm;\nexport function __wbg_set_wasm\s*\([^)]+\)\s*\{[^}]*\}/,
			[
				'',
				`import * as wasm from "./${pkg.name}_bg.wasm"`,
				`export { initialized } from "./${pkg.name}_bg.wasm"`,
				'',
			].join('\n'),
		)
		.replace(
			/\((\) \{ return (?:handle|log)Error\(function (?:.|\s*)+?\}, )arguments\)/,
			'(...args$1args)',
		)

	await writeTextFile(path, content)
}

const wasmBindgenAddDts = ({ outDir, pkg }: Params) => {
	const path = new URL(`./${pkg.name}_bg.js`, outDir)
	return appendTextFile(path, '\nexport const initialized: Promise<void>;')
}

const writePackageJson = ({ outDir, pkg, verbose }: Params) => {
	if (verbose) console.debug('[wasm build] writing package.json')
	const path = new URL('./package.json', outDir)
	const data = {
		name: pkg.name,
		version: pkg.version,
		license: pkg.license || undefined,
		type: 'module',
		files: [
			`./${pkg.name}_bg.wasm`,
			`./${pkg.name}_bg.js`,
			`./${pkg.name}.d.ts`,
		],
		module: `./${pkg.name}_bg.js`,
		types: `./${pkg.name}.d.ts`,
	}

	return writeTextFile(path, JSON.stringify(data, null, 2))
}

export const build = async (params: Params): Promise<void> => {
	await cargoBuild(params)
	await wasmBindgen(params)
	await Promise.all([
		wasmOpt(params),
		wasmBindgenModifyJs(params),
		wasmBindgenAddDts(params),
		writePackageJson(params),
	])
}
