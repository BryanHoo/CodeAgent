use std::collections::BTreeMap;

use tokio::{
    io::{self, AsyncBufRead, AsyncBufReadExt, AsyncRead, BufReader},
    sync::mpsc,
    task::JoinHandle,
};

use crate::infrastructure::diagnostics::{
    self, CodexLogParseError, DiagnosticLevel, DiagnosticSession, parse_codex_event,
};

const CODEX_LOG_QUEUE_CAPACITY: usize = 512;

pub(super) fn spawn_codex_stderr_tasks<R>(stderr: R) -> (JoinHandle<()>, JoinHandle<()>)
where
    R: AsyncRead + Send + Unpin + 'static,
{
    let (sender, mut receiver) = mpsc::channel(CODEX_LOG_QUEUE_CAPACITY);
    let writer_task = tokio::spawn(async move {
        while let Some(event) = receiver.recv().await {
            diagnostics::record_codex_event(event);
        }
    });
    let session = diagnostics::session().clone();
    let reader_task = tokio::spawn(async move {
        drain_codex_stderr(stderr, sender, session).await;
    });
    (reader_task, writer_task)
}

async fn drain_codex_stderr<R>(
    stderr: R,
    sender: mpsc::Sender<diagnostics::DiagnosticEvent>,
    session: DiagnosticSession,
) where
    R: AsyncRead + Unpin,
{
    let mut reader = BufReader::new(stderr);
    let mut line = Vec::with_capacity(1_024);
    let mut invalid_lines = 0_u64;
    let mut oversized_lines = 0_u64;
    let mut dropped_events = 0_u64;

    loop {
        match read_bounded_line(
            &mut reader,
            &mut line,
            diagnostics::MAX_CODEX_LOG_LINE_BYTES,
        )
        .await
        {
            Ok(Some(true)) => oversized_lines += 1,
            Ok(Some(false)) => match parse_codex_event(&line, &session) {
                Ok(Some(event)) => {
                    if sender.try_send(event).is_err() {
                        dropped_events += 1;
                    }
                }
                Ok(None) => {}
                Err(CodexLogParseError::TooLarge) => oversized_lines += 1,
                Err(_) => invalid_lines += 1,
            },
            Ok(None) => break,
            Err(error) => {
                diagnostics::record_warning("codex_log_read_failed", error);
                break;
            }
        }
    }

    if invalid_lines + oversized_lines + dropped_events > 0 {
        diagnostics::record(
            DiagnosticLevel::Warn,
            "codex_log_ingest_summary",
            None,
            BTreeMap::from([
                ("droppedEvents".to_owned(), dropped_events.into()),
                ("invalidLines".to_owned(), invalid_lines.into()),
                ("oversizedLines".to_owned(), oversized_lines.into()),
            ]),
        );
    }
}

async fn read_bounded_line<R: AsyncBufRead + Unpin>(
    reader: &mut R,
    output: &mut Vec<u8>,
    limit: usize,
) -> io::Result<Option<bool>> {
    output.clear();
    let mut oversized = false;
    loop {
        let available = reader.fill_buf().await?;
        if available.is_empty() {
            return if output.is_empty() && !oversized {
                Ok(None)
            } else {
                Ok(Some(oversized))
            };
        }
        let newline = available.iter().position(|byte| *byte == b'\n');
        let content_len = newline.unwrap_or(available.len());
        let remaining = limit.saturating_sub(output.len());
        output.extend_from_slice(&available[..content_len.min(remaining)]);
        oversized |= content_len > remaining;
        let consumed = newline.map_or(available.len(), |position| position + 1);
        reader.consume(consumed);
        if newline.is_some() {
            if output.last() == Some(&b'\r') {
                output.pop();
            }
            return Ok(Some(oversized));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::read_bounded_line;

    #[tokio::test]
    async fn codex_stderr_reader_should_bound_each_line_and_continue() {
        let mut input = vec![b'x'; 128];
        input.extend_from_slice(b"\n{}\n");
        let mut reader = tokio::io::BufReader::new(input.as_slice());
        let mut output = Vec::new();

        assert_eq!(
            read_bounded_line(&mut reader, &mut output, 64)
                .await
                .unwrap(),
            Some(true)
        );
        assert_eq!(output.len(), 64);
        assert_eq!(
            read_bounded_line(&mut reader, &mut output, 64)
                .await
                .unwrap(),
            Some(false)
        );
        assert_eq!(output, b"{}");
    }
}
