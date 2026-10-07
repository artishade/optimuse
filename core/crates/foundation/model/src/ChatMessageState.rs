use serde::{Deserialize, Serialize};

use crate::ChatMessage::ChatMessage;
use optimuse_link::CoreStream;
use optimuse_util::MarkdownRenderStream::MarkdownStreamEvent;

/// Carries one chat message together with its bridge-owned content stream.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ChatMessageState {
    pub message: ChatMessage,
    pub contentStream: Option<CoreStream<MarkdownStreamEvent>>,
}
