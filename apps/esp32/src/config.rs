#![allow(non_snake_case)]

/// Compile-time Wi-Fi and HTTP settings for the ESP32-2432S028 firmware.
#[derive(Clone, Debug)]
pub struct Esp32FirmwareConfig {
    pub wifiSsid: String,
    pub wifiPassword: String,
    pub httpPort: u16,
    pub edgePort: u16,
    pub edgeToken: String,
}

impl Esp32FirmwareConfig {
    /// Reads firmware settings from `OPTIMUSE_WIFI_SSID` and `OPTIMUSE_WIFI_PASSWORD`.
    pub fn fromEnv() -> Self {
        Self {
            wifiSsid: option_env!("OPTIMUSE_WIFI_SSID").unwrap_or("").to_string(),
            wifiPassword: option_env!("OPTIMUSE_WIFI_PASSWORD")
                .unwrap_or("")
                .to_string(),
            httpPort: 80,
            edgePort: 8765,
            edgeToken: option_env!("OPTIMUSE_EDGE_TOKEN").unwrap_or("").to_string(),
        }
    }

    /// Returns whether Wi-Fi station credentials were supplied at build time.
    pub fn hasWifi(&self) -> bool {
        !self.wifiSsid.trim().is_empty()
    }

    /// Reports whether the authenticated Edge carrier can be enabled.
    pub fn hasEdgeToken(&self) -> bool {
        !self.edgeToken.trim().is_empty()
    }

    /// Merges NVS runtime settings over build-time fallbacks.
    #[cfg(target_os = "espidf")]
    pub fn fromSettings(settings: &crate::settings::Esp32FirmwareSettings) -> Self {
        let build = Self::fromEnv();
        Self {
            wifiSsid: if settings.wifiSsid.trim().is_empty() {
                build.wifiSsid
            } else {
                settings.wifiSsid.trim().to_string()
            },
            wifiPassword: if settings.wifiSsid.trim().is_empty() {
                build.wifiPassword
            } else {
                settings.wifiPassword.clone()
            },
            edgeToken: if settings.edgeToken.trim().is_empty() {
                build.edgeToken
            } else {
                settings.edgeToken.clone()
            },
            httpPort: build.httpPort,
            edgePort: build.edgePort,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Verifies empty compile-time credentials disable Wi-Fi startup.
    #[test]
    fn emptyCredentialsDisableWifi() {
        let config = Esp32FirmwareConfig {
            wifiSsid: String::new(),
            wifiPassword: String::new(),
            httpPort: 80,
            edgePort: 8765,
            edgeToken: String::new(),
        };
        assert!(!config.hasWifi());
        assert!(!config.hasEdgeToken());
    }
}
