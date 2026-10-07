mod approval;
mod extension;
mod chat;
mod host;
mod local_models;
mod log;
mod market;
mod mcp;
mod memory;
mod model;
mod package;
mod people;
mod plugin;
mod prefs;
mod skill;
mod storage;
mod stt;
mod tag;
mod tool;
mod update;
mod usage;
mod util;
mod workspace;

use crate::output::CoreCommandOutput;
use optimuse_runtime::core::application::OptimuseApplication::OptimuseApplication;

/// Dispatches a top-level core command family into its command module.
pub async fn run_core_command(
    application: &mut OptimuseApplication,
    args: &[String],
    output: &mut CoreCommandOutput,
) -> Result<(), String> {
    if args.is_empty() {
        print_core_usage(output);
        return Ok(());
    }

    if matches!(args[0].as_str(), "plugin" | "package" | "skill" | "mcp")
        && args.get(1).map(String::as_str) == Some("scope")
    {
        return extension::run_scope_command(application, &args[0], &args[2..], output);
    }

    match args[0].as_str() {
        "extension" => extension::run_extension_command(application, &args[1..], output),
        "tool" => tool::run_tool_command(application, &args[1..], output).await,
        "package" => package::run_package_command(application, &args[1..], output).await,
        "plugin" => plugin::run_plugin_command(application, &args[1..], output).await,
        "skill" => skill::run_skill_command(application, &args[1..], output),
        "mcp" => mcp::run_mcp_command(application, &args[1..], output),
        "market" => market::run_market_command(application, &args[1..], output),
        "host" => host::run_host_command(application.hostManager.clone(), &args[1..], output),
        "log" => log::run_log_command(&args[1..], output),
        "local-models" => local_models::run_local_models_command(application, &args[1..], output),
        "prefs" => prefs::run_prefs_command(application.hostManager.clone(), &args[1..], output),
        "approval" => {
            approval::run_approval_command(application.hostManager.clone(), &args[1..], output)
        }
        "tag" => tag::run_tag_command(application.hostManager.clone(), &args[1..], output),
        "memory" => memory::run_memory_command(application.hostManager.clone(), &args[1..], output),
        "character" => people::run_character_command(application, &args[1..], output),
        "group" => people::run_group_command(application, &args[1..], output),
        "active-prompt" => people::run_active_prompt_command(application, &args[1..], output),
        "model" => model::run_model_command(application.hostManager.clone(), &args[1..], output),
        "chat" => chat::run_chat_command(application, &args[1..], output),
        "workspace" => workspace::run_workspace_command(application, &args[1..], output).await,
        "storage" => storage::run_storage_command(application, &args[1..], output),
        "stt" => stt::run_stt_command(application, &args[1..], output),
        "update" => update::run_update_command(&args[1..], output),
        "usage" => usage::run_usage_command(application, &args[1..], output),
        _ => {
            print_core_usage(output);
            Ok(())
        }
    }
}

/// Prints top-level command usage.
fn print_core_usage(output: &mut CoreCommandOutput) {
    let lines = vec![
        "Global option: --json  Emit machine-readable JSON.",
        "optimuse <extension|tool|package|plugin|skill|mcp|market|host|log|local-models|stt|prefs|approval|tag|memory|character|group|active-prompt|model|chat|workspace|storage|update|usage>",
        "optimuse extension <list [kind] [--scope scope]|show <kind> <id>|move <kind> <id> <device|space> --yes>",
        "optimuse <plugin|package|skill|mcp> scope <id> [device|space --yes]",
        "optimuse tool <list|show|exec>",
        "optimuse package <help|dir|list|more|load|show|import|enable|disable|use|exec>",
        "optimuse plugin <help|list|commands|exec|more|load|show|import|enable|disable>",
        "optimuse skill <dir|list|more|load|show|create|import-zip|delete|visible|errors>",
        "optimuse mcp <dir|list|show|import|export|remove|enable|disable|start|kill|tools|config|config-set|local-set|install-github|install-zip|meta|meta-set|describe>",
        "optimuse market <rank|list|search|show|comments|comment|like|notifications|my|publish|install|download>",
        "optimuse host <show>",
        "optimuse log <show|package|path|clear>",
        "optimuse local-models <paths|catalog|show|installed|installed-show|install|verify|delete|engine-delete>",
        "optimuse stt <provider-list|provider-model-list|config|transcribe|transcribe-config>",
        "optimuse prefs <show|thinking|thinking-quality|stream|media-history|mcp-timeout>",
        "optimuse approval <status|read-only|workspace-write|full>",
        "optimuse tag <list|show|create|update|delete>",
        "optimuse memory <character|shared|mount|unmount>",
        "optimuse character <init|list|show|create|update|delete|set-active|combine|reset-default>",
        "optimuse group <init|list|show|create|update|delete|set-active|duplicate>",
        "optimuse active-prompt <show|set-card|set-group|activate-for-chat|resolved-card>",
        "optimuse model <codex-login|provider-type-list|provider-list|provider-show|provider-create|provider-set-key|provider-set-endpoint|provider-model-available-list|provider-model-add|provider-model-create|list|show|use|params|parameters|context-show|context-set|summary-show|summary-set|function-list|function-show|function-set|function-reset>",
        "optimuse chat <new|list|show|current|switch|delete|delete-message|clear|rollback|branch|branches|lock|pin|stats|bind-character|bind-group|set-group|send>",
        "optimuse workspace <default-path|create-default|bind-default|bind|unbind|list|chats|commands|commands-path|run|run-path>",
        "optimuse storage <paths|migrate>",
        "optimuse update <run|check|target>",
        "optimuse usage <summary|records|models|clear>",
    ];
    for line in &lines {
        output.push_stdout_line(line);
    }
    output.setJsonStdout(serde_json::json!({"usage": lines}));
}
