use std::{
    env,
    error::Error,
    fs,
    io::Write,
    path::PathBuf,
    process::{Command, Stdio},
};

use schemars::schema::RootSchema;
use typify::{TypeSpace, TypeSpaceSettings};

fn main() -> Result<(), Box<dyn Error>> {
    let arguments = env::args_os().skip(1).collect::<Vec<_>>();
    let (check, paths) = if arguments
        .first()
        .is_some_and(|argument| argument == "--check")
    {
        (true, &arguments[1..])
    } else {
        (false, arguments.as_slice())
    };
    let [schema_path, output_path] = paths else {
        return Err("usage: code-agent-protocol-gen [--check] <schema> <output>".into());
    };
    let schema_path = PathBuf::from(schema_path);
    let output_path = PathBuf::from(output_path);

    let mut root_schema: RootSchema = serde_json::from_slice(&fs::read(schema_path)?)?;
    // typify 会合并联合分支的同名 payload，复杂联合改由 JSON Schema 直接校验。
    for definition in [
        "AgentProviderEvent",
        "AgentTaskSnapshot",
        "AgentTaskSnapshotResponse",
        "AgentTurn",
        "EventStreamMessage",
        "PendingRequest",
        "ResolvePendingRequestRequest",
        "ReviewAgentTaskRequest",
        "StartAgentTurnRequest",
        "SteerAgentTurnRequest",
    ] {
        root_schema.definitions.remove(definition);
    }
    let mut type_space = TypeSpace::new(&TypeSpaceSettings::default());
    type_space.add_root_schema(root_schema)?;
    let syntax = syn::parse2(type_space.to_stream())?;
    let unformatted = format!(
        "// 此文件由 `pnpm run protocol:rust:generate` 生成，请勿手工修改。\n\n{}",
        prettyplease::unparse(&syntax)
    );
    let generated = rustfmt(&unformatted)?;

    if check {
        let current = fs::read_to_string(&output_path).unwrap_or_default();
        if current != generated {
            return Err(format!(
                "Rust protocol code drift detected at {}. Run `pnpm run protocol:rust:generate`.",
                output_path.display()
            )
            .into());
        }
    } else {
        fs::write(output_path, generated)?;
    }

    Ok(())
}

fn rustfmt(source: &str) -> Result<String, Box<dyn Error>> {
    let mut child = Command::new("rustfmt")
        .args(["--edition", "2024", "--emit", "stdout"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    child
        .stdin
        .take()
        .ok_or("failed to open rustfmt stdin")?
        .write_all(source.as_bytes())?;
    let output = child.wait_with_output()?;
    if !output.status.success() {
        return Err(format!(
            "rustfmt failed: {}",
            String::from_utf8_lossy(&output.stderr)
        )
        .into());
    }
    String::from_utf8(output.stdout).map_err(Into::into)
}
