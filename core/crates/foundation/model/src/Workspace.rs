use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// One mounted folder inside a named workspace.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkspaceFolder {
    pub name: String,
    pub path: String,
}

/// First-class named workspace that can mount multiple VFS folders.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub folders: Vec<WorkspaceFolder>,
    pub createdAt: i64,
    pub updatedAt: i64,
}

impl Workspace {
    /// Creates a workspace with one mounted folder.
    pub fn fromSingleFolder(
        name: String,
        folderName: String,
        path: String,
        timestamp: i64,
    ) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name,
            folders: vec![WorkspaceFolder {
                name: folderName,
                path,
            }],
            createdAt: timestamp,
            updatedAt: timestamp,
        }
    }

    /// Returns the first mounted folder, which is the primary working directory.
    pub fn primaryFolder(&self) -> &WorkspaceFolder {
        self.folders
            .first()
            .expect("workspace must contain at least one folder")
    }

    /// Returns the VFS paths of every mounted folder.
    pub fn folderPaths(&self) -> Vec<String> {
        self.folders
            .iter()
            .map(|folder| folder.path.clone())
            .collect()
    }

    /// Finds a mounted folder by its display name.
    pub fn folderByName(&self, name: &str) -> Option<&WorkspaceFolder> {
        self.folders.iter().find(|folder| folder.name == name)
    }

    /// Derives a single-segment folder name from a VFS path.
    pub fn folderNameFromPath(path: &str) -> Result<String, String> {
        let trimmed = path.trim().trim_end_matches('/');
        let name = trimmed.rsplit('/').next().map(str::trim).unwrap_or("");
        if name.is_empty() || name == "." || name == ".." {
            return Err(format!("cannot derive folder name from path: {path}"));
        }
        if name.contains('\\') {
            return Err(format!("cannot derive folder name from path: {path}"));
        }
        Ok(name.to_string())
    }

    /// Validates workspace identity, name, and mounted folders.
    pub fn validate(&self) -> Result<(), String> {
        if self.id.trim().is_empty() {
            return Err("workspace id is required".to_string());
        }
        if self.name.trim().is_empty() {
            return Err("workspace name is required".to_string());
        }
        if self.folders.is_empty() {
            return Err("workspace must contain at least one folder".to_string());
        }
        let mut names = HashSet::new();
        let mut paths = HashSet::new();
        for folder in &self.folders {
            let name = folder.name.trim();
            if name.is_empty() {
                return Err("workspace folder name is required".to_string());
            }
            if name != folder.name {
                return Err(format!("invalid workspace folder name: {}", folder.name));
            }
            if name == "." || name == ".." || name.contains('/') || name.contains('\\') {
                return Err(format!("invalid workspace folder name: {name}"));
            }
            if !names.insert(name.to_string()) {
                return Err(format!("duplicate workspace folder name: {name}"));
            }
            let path = folder.path.trim();
            if path.is_empty() {
                return Err("workspace folder path is required".to_string());
            }
            if path != folder.path {
                return Err(format!("invalid workspace folder path: {}", folder.path));
            }
            if !paths.insert(path.to_string()) {
                return Err(format!("duplicate workspace folder path: {path}"));
            }
        }
        Ok(())
    }
}
