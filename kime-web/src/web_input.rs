use js_sys::JsString;
use wasm_bindgen::prelude::*;
use web_sys::EventTarget;

#[wasm_bindgen]
extern "C" {
	#[wasm_bindgen(
		extends = EventTarget,
		js_name = ___private___TextInput,
		typescript_type = "HTMLTextAreaElement | HTMLInputElement",
	)]
	#[derive(Clone)]
	pub type TextInput;

	#[wasm_bindgen(method, getter, js_name = readOnly)]
	pub fn readonly(this: &TextInput) -> bool;
	#[wasm_bindgen(method, getter)]
	pub fn disabled(this: &TextInput) -> bool;

	#[wasm_bindgen(method, getter, js_name = value)]
	pub fn value(this: &TextInput) -> JsString;
	#[wasm_bindgen(method, setter, js_name = value)]
	pub fn set_value(this: &TextInput, value: JsString);

	#[wasm_bindgen(method, getter, catch, js_name = selectionStart)]
	fn selection_start(this: &TextInput) -> Result<Option<u32>, JsValue>;

	#[wasm_bindgen(method, getter, catch, js_name = selectionEnd)]
	fn selection_end(this: &TextInput) -> Result<Option<u32>, JsValue>;

	#[wasm_bindgen(method, catch, js_name = setSelectionRange)]
	pub fn set_selection_range(
		this: &TextInput,
		start: u32,
		end: u32,
	) -> Result<(), JsValue>;
}

impl TextInput {
	pub fn selection_range(&self) -> Option<(u32, u32)> {
		let start = self.selection_start().ok().flatten()?;
		let end = self.selection_end().ok().flatten()?;
		Some((start, end))
	}
}
