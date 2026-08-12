use std::{error, fmt};

#[repr(transparent)]
pub struct StringError(pub String);

impl fmt::Display for StringError {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		f.write_str(&self.0)
	}
}

impl fmt::Debug for StringError {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		write!(f, "{:?}", &self.0)
	}
}

impl error::Error for StringError {}
