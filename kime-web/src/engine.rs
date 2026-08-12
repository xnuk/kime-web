use gloo_events::{EventListener, EventListenerOptions};
use js_sys::JsString;
use kime_engine_core::{InputCategory, InputResult};
use wasm_bindgen::prelude::{JsCast, JsError, JsValue, wasm_bindgen};
use web_sys::CustomEvent;
use web_sys::CustomEventInit;
use web_sys::KeyboardEvent;

use crate::glue_kime::KimeEngine;
use crate::helper::source::{Source, SourceRef};
use crate::helper::string_error::StringError;
use crate::web_input::TextInput;
use crate::web_keycode::from_keyboard_event;

struct Engine {
	engine: KimeEngine,
	target: TextInput,
	listeners: Vec<EventListener>,
}

#[wasm_bindgen]
#[repr(transparent)]
pub struct MountedIME(Source<Engine>);

#[wasm_bindgen]
pub fn install(config: &str, target: TextInput) -> Result<MountedIME, JsError> {
	Engine::install(config, target).map_err(|v| v.into())
}

impl Engine {
	fn install(
		config: &str,
		target: TextInput,
	) -> Result<MountedIME, StringError> {
		let engine = KimeEngine::from_str(config)?;

		let ret = Source::new(Self {
			engine,
			target,
			listeners: Vec::with_capacity(4),
		});
		let borrowed = ret.borrow();

		Engine::install_stop_composite_listener(&borrowed, "mousedown");
		Engine::install_key_listener(&borrowed, "keydown", Engine::on_keydown);

		borrowed.map(|v| v.dispatch_category_change_event().ok());

		Ok(MountedIME(ret))
	}

	fn install_stop_composite_listener(this: &SourceRef<Engine>, event: &str) {
		let target = &this.map(|v| v.target.clone()).unwrap();

		// this is passive by default
		let listener = EventListener::new(target, event.to_string(), {
			let this = this.clone();
			move |_| {
				this.map(|v| v.stop_composite());
			}
		});

		this.map(|v| v.listeners.push(listener));
	}

	fn install_key_listener(
		this: &SourceRef<Engine>,
		event: &str,
		handler: fn(&mut Self, &KeyboardEvent),
	) {
		let target = &this.map(|v| v.target.clone()).unwrap();

		let listener = EventListener::new_with_options(
			target,
			event.to_string(),
			EventListenerOptions::enable_prevent_default(),
			{
				let this = this.clone();
				move |event| {
					let event: &KeyboardEvent = event.unchecked_ref();
					this.map(|v| handler(v, event));
				}
			},
		);

		this.map(|v| v.listeners.push(listener));
	}

	fn dispatch_category_change_event(&self) -> Result<(), JsValue> {
		let category = self.engine.category();
		let event = CustomEvent::new_with_event_init_dict(
			"kimeinputcategorychange",
			&{
				let event = CustomEventInit::new();
				event.set_detail(&match category {
					InputCategory::Hangul => JsValue::from_str("hangul"),
					InputCategory::Latin => JsValue::from_str("latin"),
				});
				event
			},
		)?;

		self.target.dispatch_event(&event)?;
		Ok(())
	}

	fn on_keydown(&mut self, event: &KeyboardEvent) {
		let last_result = self.engine.last_input_result;
		let was_preedit = last_result.contains(InputResult::HAS_PREEDIT);

		if let Some(key) = from_keyboard_event(event) {
			let result = self.engine.press_key(key);

			let is_consumed = result.contains(InputResult::CONSUMED);
			let is_commit = result.contains(InputResult::HAS_COMMIT);
			let is_preedit = result.contains(InputResult::HAS_PREEDIT);

			if is_consumed {
				event.prevent_default();
			}

			if result.contains(InputResult::LANGUAGE_CHANGED) {
				self.dispatch_category_change_event().ok();
			}

			if is_consumed || is_commit || is_preedit || was_preedit {
				self.commit();
			}
		} else if was_preedit {
			self.engine.clear_preedit();
			self.commit();
			self.stop_composite();
		}
	}

	fn stop_composite(&mut self) {
		self.engine.reset();
	}

	fn commit(&mut self) {
		let input = &self.target;
		let (start, end) = input.selection_range().unwrap_or_default();

		let (before, after) = {
			let text = input.value();
			let before = text.slice(0, start);
			let after = text.slice(end, text.length());
			(before, after)
		};

		let commit = JsString::from(self.engine.commit_str());
		self.engine.clear_commit();

		let preedit = JsString::from(self.engine.preedit_str());

		let new_start = start + commit.length();
		let new_end = new_start + preedit.length();

		input.set_value(before.concat(&commit).concat(&preedit).concat(&after));
		input.set_selection_range(new_start, new_end).ok();
	}
}
