use std::collections::HashSet;

use code_agent_core::CodeAgentError;
use serde_json::Value;

const MAX_PAGES: usize = 1_000;

pub(crate) struct PaginationGuard {
    context: &'static str,
    max_items: usize,
    pages: usize,
    seen: HashSet<String>,
}

impl PaginationGuard {
    pub(crate) fn new(context: &'static str, max_items: usize) -> Self {
        Self {
            context,
            max_items,
            pages: 0,
            seen: HashSet::new(),
        }
    }

    pub(crate) fn advance(
        &mut self,
        response: &Value,
        total_items: usize,
    ) -> Result<Option<String>, CodeAgentError> {
        self.pages += 1;
        if self.pages > MAX_PAGES || total_items > self.max_items {
            return Err(CodeAgentError::internal(format!(
                "{} pagination limit exceeded",
                self.context
            )));
        }
        match response.get("nextCursor") {
            None | Some(Value::Null) => Ok(None),
            Some(Value::String(cursor)) if self.seen.insert(cursor.clone()) => {
                Ok(Some(cursor.clone()))
            }
            Some(Value::String(_)) => Err(CodeAgentError::internal(format!(
                "{} returned a repeated cursor",
                self.context
            ))),
            Some(_) => Err(CodeAgentError::internal(format!(
                "{} nextCursor must be a string or null",
                self.context
            ))),
        }
    }
}
