//! Generated external Plugin SDK client wrappers.

pub use optimuse_plugin_sdk_ipc::PluginSdkClient;
pub use optimuse_plugin_sdk_host::registerAndroidClient as register_android_client;

mod generated;

pub use generated::*;

/// Activates the installed Optimuse application and connects through its platform IPC carrier.
pub fn connect() -> Result<PluginSdkClient, optimuse_link::CoreLinkError> {
    PluginSdkClient::connect(optimuse_plugin_sdk_host::createPluginSdkHost(), optimuse_host_api::PluginSdkIpcEndpoint::standard())
}

/// Decodes one Core MessagePack value into a Rust SDK model.
pub fn decode_messagepack_value<T: serde::de::DeserializeOwned>(value: &optimuse_link::CoreValue) -> Result<T, optimuse_link::CoreLinkError> {
    let bytes = rmp_serde::to_vec(value).map_err(|error| optimuse_link::CoreLinkError::internal(error.to_string()))?;
    rmp_serde::from_slice(&bytes).map_err(|error| optimuse_link::CoreLinkError::internal(error.to_string()))
}

/// Typed wrapper over the Core watch event stream.
pub struct OptimusePluginSdkTypedEventStream<T> {
    stream: optimuse_link::CoreEventStream,
    marker: std::marker::PhantomData<T>,
}

impl<T> OptimusePluginSdkTypedEventStream<T> {
    /// Creates a typed stream over one Core event stream.
    pub fn new(stream: optimuse_link::CoreEventStream) -> Self { Self { stream, marker: std::marker::PhantomData } }
}

impl<T: serde::de::DeserializeOwned> OptimusePluginSdkTypedEventStream<T> {
    /// Receives and decodes the next MessagePack event value.
    pub async fn recv(&mut self) -> Option<Result<T, optimuse_link::CoreLinkError>> {
        self.stream.recv().await.map(|event| decode_messagepack_value(&event.value))
    }
}
