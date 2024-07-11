import { install, initialized, type MountedIME } from 'kime-web'
import { importUrl, parseUrl } from './layout-from-url.ts'
import { installFileDrop, isYamlPath } from './filedrop.ts'

const configInput = document.getElementById('config') as HTMLTextAreaElement
const textInput = document.getElementById('scratchpad') as HTMLTextAreaElement
const errorSlot = document.getElementById('error') as HTMLDivElement
const status = document.getElementById('status') as HTMLDivElement

configInput.placeholder = `# Kime 설정
engine:
  hangul:
    layout: mylayout
  # ...

layouts:
  mylayout:
    Q: '$ㅅ$ㅒ'
    # ...

# 또는 파일 드래그 앤 드롭
# 또는 https:// 로 시작하는 URL 붙여넣기`

const instantiate = (config: string) => {
	try {
		const ret = install(config, textInput)
		errorSlot.textContent = ''
		return ret
	} catch (err: unknown) {
		if (typeof err !== 'object' || err == null) {
			return null
		}

		if ('message' in err && typeof err.message === 'string') {
			errorSlot.textContent = err.message
		}

		return null
	}
}

const reload = (() => {
	let instance = null as null | MountedIME
	let ready = false

	const reloader = () => {
		if (!ready) return
		if (instance != null) {
			instance.free()
		}
		instance = instantiate(configInput.value)
	}

	initialized.then(() => {
		ready = true
		reloader()
	})

	return reloader
})()

const debounced = <F extends (...args: any[]) => any>(func: F, delay = 50) => {
	let timeout = setTimeout(() => {})

	return (...args: Parameters<F>) => {
		clearTimeout(timeout)
		timeout = setTimeout(() => func(...args), delay)
	}
}

const fetcher = debounced((url: URL, value: string) => {
	importUrl(url)
		.then(config => {
			if (configInput.value !== value) return
			configInput.value = config
			errorSlot.textContent = ''
			reload()
		})
		.catch(() => {
			errorSlot.textContent = `Failed to fetch ${url}.`
		})
}, 500)

configInput.addEventListener('input', () => {
	const url = parseUrl(configInput.value)
	if (url == null || !isYamlPath(url.pathname)) {
		return reload()
	}

	errorSlot.textContent = `Fetching ${url}...`
	fetcher(url, configInput.value)
})

textInput.addEventListener('kimeinputcategorychange', e => {
	const category = (e as CustomEvent<'hangul' | 'latin'>).detail
	const categoryText = category === 'hangul' ? '한글' : category

	if (status.textContent !== categoryText) {
		status.textContent = categoryText
		status.animate([{ opacity: 0.75, display: 'block' }, { opacity: 0 }], {
			duration: 2000,
			iterations: 1,
			easing: 'ease-in',
		})
	}
})

installFileDrop(configInput, text => {
	configInput.value = text
	reload()
})

declare global {
	const SERVE: boolean
}

if (SERVE) {
	new EventSource('/esbuild').addEventListener('change', () =>
		location.reload(),
	)
}
