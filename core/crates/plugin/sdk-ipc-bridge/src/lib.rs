//! Application wiring for the external Plugin SDK IPC server.

use std::sync::Arc;

use optimuse_host_api::{PluginSdkIpcEndpoint, PluginSdkIpcHost};
use optimuse_plugin_sdk_ipc::{PluginSdkIpcServer, PluginSdkLinkTarget, PluginSdkSurface};

/// Builds the SDK IPC server around an existing Core Link target.
pub struct OptimusePluginSdkIpcBridge {
    server: PluginSdkIpcServer,
}

impl OptimusePluginSdkIpcBridge {
    /// Creates the platform SDK bridge without introducing a tool-specific handler.
    pub fn new(
        host: Arc<dyn PluginSdkIpcHost>,
        endpoint: PluginSdkIpcEndpoint,
        target: Arc<dyn PluginSdkLinkTarget>,
        surface: PluginSdkSurface,
    ) -> Self {
        Self {
            server: PluginSdkIpcServer::new(host, endpoint, target, surface),
        }
    }

    /// Starts the SDK IPC listener owned by the running Core application.
    pub fn start(&self) -> Result<(), optimuse_link::CoreLinkError> {
        self.server.start()
    }

    /// Stops the SDK IPC listener owned by the running Core application.
    pub fn stop(&self) -> Result<(), optimuse_link::CoreLinkError> {
        self.server.stop()
    }
}
