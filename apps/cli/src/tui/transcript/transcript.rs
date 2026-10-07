use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};

use optimuse_model::ChatMessage::ChatMessage;
use optimuse_model::InputProcessingState::InputProcessingState;
use ratatui::text::Line;

use super::empty_state::render_blue_cat_lines;
use super::fold::{FoldedLines, TranscriptFoldHit, TranscriptFoldState};
use super::helpers::{
    is_streaming_message_for_tui, render_input_error_lines, render_loading_ai_placeholder_lines,
    render_transcript_message_lines_with_cache,
};
use super::i18n::{TuiLanguage, TuiText};
use super::typewriter::TypewriterState;

#[derive(Clone, Debug, Default)]
pub(super) struct TranscriptRenderCache {
    pub(super) xml: Vec<super::compose::XmlSurfaceSlot>,
    chat_id: Option<String>,
    pub(super) messages: HashMap<i64, TranscriptMessageRenderCache>,
    pub(super) fold_state: TranscriptFoldState,
    pub(super) fold_hits: Vec<TranscriptFoldHit>,
}

#[derive(Clone, Debug)]
pub(super) struct TranscriptMessageRenderCache {
    pub(super) xml: Vec<super::compose::XmlSurfaceSlot>,
    pub(super) key: TranscriptMessageRenderKey,
    pub(super) lines: Vec<Line<'static>>,
    pub(super) fold_hits: Vec<TranscriptFoldHit>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct TranscriptMessageRenderKey {
    timestamp: i64,
    content_width: usize,
    sender: String,
    role_name: String,
    provider: String,
    model_name: String,
    output_tokens: i64,
    content_hash: u64,
    fold_signature: u64,
    language: TuiLanguage,
}

impl TranscriptMessageRenderKey {
    pub(super) fn build(
        message: &ChatMessage,
        content_width: usize,
        language: TuiLanguage,
        fold_signature: u64,
    ) -> Self {
        let content = if message.sender == "ai" {
            format!("{:?}", message.parts)
        } else {
            message.displayText()
        };
        Self {
            timestamp: message.timestamp,
            content_width,
            sender: message.sender.clone(),
            role_name: message.roleName.clone(),
            provider: message.provider.clone(),
            model_name: message.modelName.clone(),
            output_tokens: message.outputTokens,
            content_hash: stable_content_hash(&content),
            fold_signature,
            language,
        }
    }
}

pub(super) fn render_transcript_lines(
    messages: &[ChatMessage],
    current_chat_id: Option<&str>,
    is_loading: bool,
    input_state: &InputProcessingState,
    thinking_line: &Line<'static>,
    content_width: usize,
    typewriter_state: &mut TypewriterState,
    transcript_cache: &mut TranscriptRenderCache,
    text: TuiText,
) -> Vec<Line<'static>> {
    if messages.is_empty() {
        transcript_cache.clear();
        return render_blue_cat_lines(content_width, text);
    }

    transcript_cache.ensure_chat_id(current_chat_id);
    let active_message_timestamps = messages
        .iter()
        .map(|message| message.timestamp)
        .collect::<HashSet<_>>();
    typewriter_state.retain_messages(&active_message_timestamps);
    transcript_cache
        .fold_state
        .retain_messages(&active_message_timestamps);
    transcript_cache
        .messages
        .retain(|timestamp, _| active_message_timestamps.contains(timestamp));
    transcript_cache.fold_hits.clear();

    let mut output = FoldedLines::default();
    for (index, message) in messages.iter().enumerate() {
        if !output.lines.is_empty() {
            output.lines.push(Line::from(""));
        }
        let streaming_message =
            is_streaming_message_for_tui(message, index, messages.len(), is_loading);
        let fold_signature = transcript_cache
            .fold_state
            .signature_for_message(message.timestamp);
        if streaming_message {
            let rendered = render_transcript_message_lines_with_cache(
                message,
                index,
                messages.len(),
                content_width,
                is_loading,
                thinking_line,
                typewriter_state,
                &transcript_cache.fold_state,
                text,
            );
            let cache = transcript_cache
                .messages
                .entry(message.timestamp)
                .or_insert_with(|| TranscriptMessageRenderCache {
                    xml: Vec::new(),
                    key: TranscriptMessageRenderKey::build(
                        message,
                        content_width,
                        text.language(),
                        fold_signature,
                    ),
                    lines: Vec::new(),
                    fold_hits: Vec::new(),
                });
            cache.key = TranscriptMessageRenderKey::build(
                message,
                content_width,
                text.language(),
                fold_signature,
            );
            cache.lines = rendered.lines.clone();
            cache.xml = rendered.xml.clone();
            cache.fold_hits = rendered.hits.clone();
            output.extend(rendered);
            continue;
        }

        let key = TranscriptMessageRenderKey::build(
            message,
            content_width,
            text.language(),
            fold_signature,
        );
        if let Some(cached) = transcript_cache
            .messages
            .get(&message.timestamp)
            .filter(|cached| cached.key == key)
        {
            let cached_block = FoldedLines {
                xml: cached.xml.clone(),
                lines: cached.lines.clone(),
                hits: cached.fold_hits.clone(),
            };
            output.extend(cached_block);
            continue;
        }

        let rendered = render_transcript_message_lines_with_cache(
            message,
            index,
            messages.len(),
            content_width,
            is_loading,
            thinking_line,
            typewriter_state,
            &transcript_cache.fold_state,
            text,
        );
        transcript_cache.messages.insert(
            message.timestamp,
            TranscriptMessageRenderCache {
                xml: rendered.xml.clone(),
                key,
                lines: rendered.lines.clone(),
                fold_hits: rendered.hits.clone(),
            },
        );
        output.extend(rendered);
    }
    if is_loading && matches!(messages.last(), Some(message) if message.sender == "user") {
        if !output.lines.is_empty() {
            output.lines.push(Line::from(""));
        }
        output.lines.extend(render_loading_ai_placeholder_lines(
            content_width,
            thinking_line,
        ));
    }
    output
        .lines
        .extend(render_input_error_lines(input_state, text));
    transcript_cache.fold_hits = output.hits;
    transcript_cache.xml = output.xml;
    output.lines
}

impl TranscriptRenderCache {
    pub(super) fn clear(&mut self) {
        self.xml.clear();
        self.chat_id = None;
        self.messages.clear();
        self.fold_state.clear();
        self.fold_hits.clear();
    }

    /// Records a user click that toggles one fold widget.
    pub(super) fn toggle_fold_at_line(&mut self, line_index: usize) -> bool {
        let Some(hit) = self
            .fold_hits
            .iter()
            .find(|hit| hit.line_index == line_index)
            .cloned()
        else {
            return false;
        };
        self.fold_state.set_user_expanded(
            hit.target.message_timestamp,
            &hit.target.stable_key,
            !hit.target.expanded,
        );
        true
    }

    fn ensure_chat_id(&mut self, chat_id: Option<&str>) {
        let next_chat_id = chat_id.map(ToString::to_string);
        if self.chat_id == next_chat_id {
            return;
        }
        self.chat_id = next_chat_id;
        self.xml.clear();
        self.messages.clear();
        self.fold_state.clear();
        self.fold_hits.clear();
    }
}

fn stable_content_hash(content: &str) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    content.hash(&mut hasher);
    hasher.finish()
}
