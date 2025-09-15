import type { Plugin } from 'esbuild'
import {
	isAbsolute,
	pathJoin,
	dirname,
	realPath,
	readFile,
	readTextFile,
} from './fs.ts'

interface RenamedMap {
	readonly module: Readonly<Record<string, string>>
	readonly functions: Readonly<Record<string, string>>
}

const getRenamedModule = (r: RenamedMap | null, id: string) => ({
	id,
	original: r?.module[id] || id,
})

const getRenamedFunc = (r: RenamedMap | null, id: string) => ({
	id,
	original: r?.functions[id] || id,
})

const makeImports = (
	imports: readonly WebAssembly.ModuleImportDescriptor[],
	renamedMap: RenamedMap | null = null,
): { readonly head: string; readonly body: string } => {
	const map = Object.create(null) as {
		[key: string]: {
			meta: { id: string; original: string }
			data: { id: string; original: string }[]
		}
	}
	for (const { module, name } of imports) {
		map[module] ||= {
			meta: getRenamedModule(renamedMap, module),
			data: [],
		}

		const data = map[module].data

		data.push(getRenamedFunc(renamedMap, name))
	}

	const values = Object.values(map)
	const importEntries = values.map(({ meta: mod, data }, index) => {
		const name = '$wasm_import_' + index
		const head = `import * as ${name} from ${JSON.stringify(mod.original)}`
		const bodyRaw = data
			.map(entry => {
				const id = JSON.stringify(entry.id)
				const original = JSON.stringify(entry.original)
				return `[${id}]: ${name}[${original}]`
			})
			.join(', \n')
		const body = `[${JSON.stringify(mod.id)}]: {${bodyRaw}}`
		return { head, body }
	})

	const head = importEntries.map(v => v.head).join('\n')
	const body = '{' + importEntries.map(v => v.body).join(', ') + '}'

	return { head, body }
}

const makeExports = (
	exports: readonly WebAssembly.ModuleExportDescriptor[],
	renamedMap: RenamedMap | null = null,
): { readonly head: string; readonly body: string } => {
	const entries = exports.map(({ name }) => {
		const { id, original } = getRenamedFunc(renamedMap, name)
		return {
			head: `export let ${original};`,
			body: `${original} = $exports[${JSON.stringify(id)}];`,
		}
	})

	return {
		head: entries.map(v => v.head).join('\n'),
		body: entries.map(v => v.body).join('\n'),
	}
}

const generateWasmModule = async (path: string): Promise<string> => {
	const mod = await readFile(path).then(x =>
		WebAssembly.compile(x as Buffer<ArrayBuffer>),
	)
	const renamedMap = await readTextFile(path + '.renamed.json').then(
		v => {
			const json = JSON.parse(v) as unknown
			if (
				typeof json === 'object' &&
				json != null &&
				'version' in json &&
				json.version === 'xnuk-r1'
			) {
				return json as unknown as RenamedMap
			}
			return null
		},
		() => null,
	)
	const imp = makeImports(WebAssembly.Module.imports(mod), renamedMap)
	const exp = makeExports(WebAssembly.Module.exports(mod), renamedMap)

	return `
		import $wasm_path from ${JSON.stringify(path)}
		${imp.head}
		${exp.head}
		export const initialized =
			WebAssembly.instantiateStreaming(
				fetch(
					new URL($wasm_path, import.meta.url),
					{ headers: { accept: 'application/wasm' } }
				),
				${imp.body}
			).then($wasm => {
				const $exports = $wasm.instance.exports
				${exp.body}
			})
	`
}

export const wasmLoader: Plugin = {
	name: 'wasm-loader',
	setup(build) {
		const moduleNamespace = 'wasm-module'
		const binaryNamespace = 'wasm-binary'
		build.onResolve({ filter: /\.wasm$/ }, async arg => {
			const { path, resolveDir, namespace } = arg
			if (namespace === moduleNamespace) {
				return {
					namespace: binaryNamespace,
					path,
				}
			}

			if (resolveDir === '') return

			return {
				namespace: moduleNamespace,
				path: await realPath(
					isAbsolute(path) ? path : pathJoin(resolveDir, path),
				),
			}
		})

		build.onLoad({ filter: /.*/, namespace: moduleNamespace }, arg =>
			generateWasmModule(arg.path).then(contents => ({
				contents,
				resolveDir: dirname(arg.path),
			})),
		)

		build.onLoad({ filter: /.*/, namespace: binaryNamespace }, arg =>
			readFile(arg.path).then(contents => ({
				contents,
				loader: 'file',
			})),
		)
	},
}
