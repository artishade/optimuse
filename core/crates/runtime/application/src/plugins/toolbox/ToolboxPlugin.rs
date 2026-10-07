use crate::plugins::PluginRegistry::OptimusePlugin;

pub struct ToolboxPlugin;

impl OptimusePlugin for ToolboxPlugin {
    fn id(&self) -> &str {
        "builtin.toolbox"
    }

    fn register(&self) {}
}
