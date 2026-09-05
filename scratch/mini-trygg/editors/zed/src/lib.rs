use std::{collections::HashMap, path::Path};

use zed::settings::LspSettings;
use zed_extension_api as zed;

const SERVER_ID: &str = "mini-check";
const WORKSPACE_PACKAGE: &str = "trygg-workspace";
const MINI_PACKAGE: &str = "mini-check";

fn default_server_path(package_name: Option<&str>) -> Option<&'static str> {
    match package_name {
        Some(WORKSPACE_PACKAGE) => Some("scratch/mini-trygg/dist/lsp.mjs"),
        Some(MINI_PACKAGE) => Some("dist/lsp.mjs"),
        _ => None,
    }
}

struct MiniCheckExtension;

impl MiniCheckExtension {
    fn validate_server(language_server_id: &zed::LanguageServerId) -> zed::Result<()> {
        if language_server_id.as_ref() == SERVER_ID {
            Ok(())
        } else {
            Err(format!(
                "unsupported language server id `{language_server_id}`; expected `{SERVER_ID}`"
            ))
        }
    }

    fn absolute_worktree_path(worktree: &zed::Worktree, relative: &str) -> String {
        format!(
            "{}/{}",
            worktree.root_path().trim_end_matches('/'),
            relative.trim_start_matches('/')
        )
    }

    fn resolve_server_path(
        worktree: &zed::Worktree,
        settings: Option<&zed::serde_json::Value>,
    ) -> zed::Result<String> {
        let configured = settings
            .and_then(|settings| settings.get("server_path"))
            .and_then(zed::serde_json::Value::as_str)
            .filter(|path| !path.is_empty());

        if let Some(path) = configured {
            if Path::new(path).is_absolute() {
                return Ok(path.to_owned());
            }
            return Ok(Self::absolute_worktree_path(worktree, path));
        }

        let package = worktree
            .read_text_file("package.json")
            .ok()
            .and_then(|contents| {
                zed::serde_json::from_str::<zed::serde_json::Value>(&contents).ok()
            });
        let package_name = package
            .as_ref()
            .and_then(|package| package.get("name"))
            .and_then(zed::serde_json::Value::as_str);

        let relative = default_server_path(package_name).ok_or_else(|| {
            format!(
                    "mini-check could not identify this remote worktree from package.json; open the trygg repository or mini-check root, or configure lsp.{SERVER_ID}.settings.server_path"
                )
        })?;

        Ok(Self::absolute_worktree_path(worktree, relative))
    }
}

impl zed::Extension for MiniCheckExtension {
    fn new() -> Self {
        Self
    }

    fn language_server_command(
        &mut self,
        language_server_id: &zed::LanguageServerId,
        worktree: &zed::Worktree,
    ) -> zed::Result<zed::Command> {
        Self::validate_server(language_server_id)?;
        let settings = LspSettings::for_worktree(SERVER_ID, worktree)?;
        let binary = settings.binary;

        let command = binary
            .as_ref()
            .and_then(|binary| binary.path.clone())
            .or_else(|| worktree.which("node"))
            .ok_or_else(|| {
                format!(
                    "Node.js was not found in the remote worktree; configure lsp.{SERVER_ID}.binary.path with a remote Node executable or put `node` on the remote PATH"
                )
            })?;

        let args = match binary.as_ref().and_then(|binary| binary.arguments.clone()) {
            Some(arguments) => arguments,
            None => vec![
                Self::resolve_server_path(worktree, settings.settings.as_ref())?,
                "--stdio".to_owned(),
            ],
        };

        let mut env: HashMap<String, String> = worktree.shell_env().into_iter().collect();
        if let Some(configured_env) = binary.and_then(|binary| binary.env) {
            env.extend(configured_env);
        }

        Ok(zed::Command {
            command,
            args,
            env: env.into_iter().collect(),
        })
    }

    fn language_server_initialization_options(
        &mut self,
        language_server_id: &zed::LanguageServerId,
        worktree: &zed::Worktree,
    ) -> zed::Result<Option<zed::serde_json::Value>> {
        Self::validate_server(language_server_id)?;
        Ok(LspSettings::for_worktree(SERVER_ID, worktree)?.initialization_options)
    }

    fn language_server_workspace_configuration(
        &mut self,
        language_server_id: &zed::LanguageServerId,
        worktree: &zed::Worktree,
    ) -> zed::Result<Option<zed::serde_json::Value>> {
        Self::validate_server(language_server_id)?;
        Ok(LspSettings::for_worktree(SERVER_ID, worktree)?.settings)
    }
}

zed::register_extension!(MiniCheckExtension);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_supported_worktree_package_names() {
        assert_eq!(
            default_server_path(Some(WORKSPACE_PACKAGE)),
            Some("scratch/mini-trygg/dist/lsp.mjs")
        );
        assert_eq!(
            default_server_path(Some(MINI_PACKAGE)),
            Some("dist/lsp.mjs")
        );
        assert_eq!(default_server_path(Some("other")), None);
        assert_eq!(default_server_path(None), None);
    }
}
