import { spawn } from 'node:child_process'
import type {
	SpawnOptionsWithStdioTuple,
	SpawnOptions,
	StdioNull,
	StdioPipe,
} from 'node:child_process'

type CommandRunner<T> = (
	command: string,
	...args: readonly string[]
) => Promise<T>

export const Runner = (
	defaultOptions: SpawnOptions,
): {
	readonly run: CommandRunner<void>
	readonly read: CommandRunner<Blob>
} => {
	const wrapper =
		<
			O extends SpawnOptionsWithStdioTuple<
				any,
				StdioNull | StdioPipe,
				StdioNull | StdioPipe
			>,
		>(
			options: O,
		) =>
		(command: string, ...args: readonly string[]) =>
			new Promise<
				O['stdio'] extends [any, 'pipe', any] | [any, any, 'pipe']
					? Blob
					: void
			>((ok, error) => {
				const child = spawn(command, args, options)
				const buffers: Uint8Array<ArrayBuffer>[] = []

				if (child.stdout != null) {
					child.stdout.on('data', (data: Buffer) =>
						buffers.push(data as Uint8Array<ArrayBuffer>),
					)
				}

				if (child.stderr != null) {
					child.stderr.on('data', (data: Buffer) =>
						buffers.push(data as Uint8Array<ArrayBuffer>),
					)
				}

				const hasOutput = child.stdout != null || child.stderr != null

				child.on('error', error)
				child.on('close', code => {
					if (code !== 0) {
						return error(
							new Error(
								`non-zero exit code ${code} executing:\n  ${command} ${args.join(
									' ',
								)}`,
							),
						)
					}

					const okay = ok as (value: Blob | undefined) => void

					if (!hasOutput) okay(undefined)
					okay(new Blob(buffers))
				})
			})

	return {
		run: wrapper({
			...defaultOptions,
			stdio: ['ignore', 'inherit', 'inherit'],
		}),

		read: wrapper({
			...defaultOptions,
			stdio: ['ignore', 'pipe', 'inherit'],
		}),
	}
}
