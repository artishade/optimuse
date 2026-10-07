use optimuse_host_api::RuntimeStorageHost;
use optimuse_providers::chat::llmprovider::CodexOAuth::CodexOAuthTokens;
use optimuse_store::PreferencesDataStore::{stringPreferencesKey, CoreNodeSecretStore, Preferences};
use optimuse_store::RuntimeStorageHost::defaultRuntimeStorageHost;
use optimuse_util::OptimusePaths;

/// Stores the ChatGPT Codex OAuth session for one Core node.
pub struct CodexAuthPreferences {
    dataStore: CoreNodeSecretStore,
}

impl CodexAuthPreferences {
    /// Opens Codex credentials from the default runtime directory.
    pub fn getInstance() -> Self {
        Self {
            dataStore: CoreNodeSecretStore::newWithStorage(
                defaultRuntimeStorageHost(),
                OptimusePaths::CODEX_AUTH_PREFERENCES_PATH,
            ),
        }
    }

    /// Replaces the saved Codex OAuth session.
    #[optimuse_route_macros::optimuse_core_internal]
    pub fn save(&self, tokens: &CodexOAuthTokens) -> Result<(), String> {
        let encoded = serde_json::to_string(tokens).map_err(|error| error.to_string())?;
        self.dataStore
            .edit(|preferences| {
                preferences.set(&stringPreferencesKey("tokens"), encoded.clone());
            })
            .map_err(|error| error.to_string())
    }

    /// Returns the saved Codex OAuth session.
    #[optimuse_route_macros::optimuse_core_internal]
    pub fn load(&self) -> Result<Option<CodexOAuthTokens>, String> {
        let preferences = self
            .dataStore
            .dataFlow()
            .first()
            .map_err(|error| error.to_string())?;
        read_tokens(&preferences)
    }

    /// Removes the saved Codex OAuth session.
    pub fn clear(&self) -> Result<(), String> {
        self.dataStore
            .edit(|preferences| {
                preferences.remove(&stringPreferencesKey("tokens"));
            })
            .map_err(|error| error.to_string())
    }
}

fn read_tokens(preferences: &Preferences) -> Result<Option<CodexOAuthTokens>, String> {
    let Some(encoded) = preferences.get(&stringPreferencesKey("tokens")) else {
        return Ok(None);
    };
    serde_json::from_str(encoded)
        .map(Some)
        .map_err(|error| error.to_string())
}
