use std::collections::HashMap;

use kime_engine_backend_hangul::{HangulData, Layout, builtin_layouts};
use kime_engine_core::{
	Config, EngineConfig, InputCategory, InputEngine, InputResult, Key,
};
use serde::Deserialize;

use crate::helper::string_error::StringError;

fn split_config(config: &str) -> (&str, HashMap<&str, String>) {
	let (engine_str, layouts_str) = {
		if let Some(x) = config.rsplit_once("\nlayouts:\n") {
			x
		} else if let Some(layouts) = config.strip_prefix("layouts:\n")
			&& let Some(engine_index) = layouts.find("\nengine:")
		{
			(&layouts[engine_index..], &layouts[..engine_index])
		} else {
			return (config, HashMap::new());
		}
	};

	fn split_indent(line: &str) -> (usize, &str) {
		let bytes = line.as_bytes();
		let bytes_len = bytes.len();
		let mut indent = 0usize;
		while indent < bytes_len && bytes[indent] == b' ' {
			indent += 1;
		}

		(indent, &line[indent..])
	}

	let mut layouts = HashMap::new();
	let mut lines = layouts_str.split('\n').peekable();

	while let Some(line) = lines.next() {
		if line.trim().is_empty() {
			continue;
		}

		let (key_indent, line) = split_indent(line);
		if key_indent == 0 {
			break;
		}
		let Some(key) = line.trim().strip_suffix(':') else {
			break;
		};

		let mut buf = String::new();
		let mut content_indent = None;

		while let Some(line) = lines.peek() {
			if line.trim().is_empty() {
				buf.push('\n');
				lines.next();
				continue;
			}

			let (current_indent, stripped_line) = split_indent(line);
			if current_indent <= key_indent {
				break;
			}

			if let Some(content_indent) = content_indent
				&& current_indent >= content_indent
			{
				buf.push_str(&line[content_indent..]);
			} else {
				content_indent = Some(current_indent);
				buf.push_str(stripped_line);
			}
			lines.next();
			buf.push('\n');
		}

		if !buf.is_empty() {
			layouts.insert(key, buf);
		}
	}

	(engine_str, layouts)
}

#[derive(Deserialize)]
#[repr(transparent)]
struct HangulLayoutData(HashMap<Key, String>);

impl From<HangulLayoutData> for Layout {
	fn from(value: HangulLayoutData) -> Self {
		Layout::from_items(value.0)
	}
}

#[derive(Deserialize)]
struct RawConfig {
	engine: Option<EngineConfig>,
}

fn parse_config(config: &str) -> Result<Config, StringError> {
	let (engine_str, layouts_str) = split_config(config);
	let RawConfig { engine } = serde_yaml::from_str(engine_str)
		.map_err(|err| StringError(err.to_string()))?;

	if let Some(engine) = engine {
		let mut layouts = Vec::with_capacity(layouts_str.len());
		for (key, layout_str) in layouts_str {
			let layout = Layout::load_from(&layout_str)
				.map_err(|err| StringError(err.to_string()))?;
			layouts.push((key.to_owned().into(), layout));
		}

		let hangul_data = if layouts.is_empty() {
			None
		} else {
			Some(HangulData::new(
				&engine.hangul,
				builtin_layouts().chain(layouts),
			))
		};

		let mut config = Config::new(engine);
		if let Some(hangul_data) = hangul_data {
			config.hangul_data = hangul_data;
		}

		Ok(config)
	} else {
		Ok(Config::default())
	}
}

pub struct KimeEngine {
	pub config: Config,
	pub engine: InputEngine,
	pub last_input_result: InputResult,
}

impl KimeEngine {
	pub fn from_str(config: &str) -> Result<Self, StringError> {
		let config = parse_config(config)?;
		let engine = InputEngine::new(&config);

		Ok(Self {
			config,
			engine,
			last_input_result: InputResult::empty(),
		})
	}

	#[inline]
	pub fn press_key(&mut self, key: Key) -> InputResult {
		let result = self.engine.press_key(key, &self.config);
		self.last_input_result = result;
		result
	}

	#[inline]
	pub fn category(&self) -> InputCategory {
		self.engine.category()
	}

	#[inline]
	pub fn clear_commit(&mut self) {
		self.engine.clear_commit()
	}

	#[inline]
	pub fn clear_preedit(&mut self) {
		self.engine.clear_preedit()
	}

	#[inline]
	pub fn preedit_str(&mut self) -> &str {
		self.engine.preedit_str()
	}

	#[inline]
	pub fn commit_str(&mut self) -> &str {
		self.engine.commit_str()
	}

	#[inline]
	pub fn reset(&mut self) {
		self.engine.reset();
		self.last_input_result = InputResult::empty();
	}
}
