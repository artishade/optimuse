use optimuse_host_api::RuntimeSqliteConnection;

/// The last shared database schema version before Optimuse1 and Optimuse diverged.
const OPTIMUSE1_ROOM_SCHEMA_DIVERGENCE_VERSION: i32 = 20;

/// The current Optimuse SQLite schema version that receives imported chat archives.
const OPTIMUSE_SQLITE_CURRENT_SCHEMA_VERSION: i32 = optimuse_store::db::AppDatabase::DATABASE_VERSION;

/// Identifies the normalized Optimuse1 Room source schema used by an import bridge.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Optimuse1RoomSchemaVersion {
    V10,
    V20,
    V21,
}

impl Optimuse1RoomSchemaVersion {
    /// Returns the SQLite user version represented by this Optimuse1 Room schema.
    const fn sqliteUserVersion(self) -> i32 {
        match self {
            Self::V10 => 10,
            Self::V20 => 20,
            Self::V21 => 21,
        }
    }
}

/// Identifies one explicit Optimuse1 Room to Optimuse SQLite archive bridge.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum Optimuse1ToOptimuseChatArchiveBridge {
    Optimuse1RoomV10ToOptimuseSqliteV27,
    Optimuse1RoomV20ToOptimuseSqliteV27,
    Optimuse1RoomV21ToOptimuseSqliteV27,
}

impl Optimuse1ToOptimuseChatArchiveBridge {
    /// Returns the exact Optimuse SQLite target schema required by this bridge.
    const fn optimuseTargetSchemaVersion(self) -> i32 {
        match self {
            Self::Optimuse1RoomV10ToOptimuseSqliteV27 => 27,
            Self::Optimuse1RoomV20ToOptimuseSqliteV27 => 27,
            Self::Optimuse1RoomV21ToOptimuseSqliteV27 => 27,
        }
    }
}

/// Resolves the exact Optimuse1 Room source schema and its Optimuse import bridge.
pub(crate) fn prepareOptimuse1RoomImport(
    connection: &mut dyn RuntimeSqliteConnection,
) -> Result<Optimuse1ToOptimuseChatArchiveBridge, String> {
    selectOptimuse1ToOptimuseChatArchiveBridge(connection)
}

/// Selects the bridge for the opened Optimuse1 Room database version.
fn selectOptimuse1ToOptimuseChatArchiveBridge(
    connection: &mut dyn RuntimeSqliteConnection,
) -> Result<Optimuse1ToOptimuseChatArchiveBridge, String> {
    let sourceSchemaVersion = match readOptimuse1RoomSchemaVersion(connection)? {
        10 => Optimuse1RoomSchemaVersion::V10,
        20 => Optimuse1RoomSchemaVersion::V20,
        21 => Optimuse1RoomSchemaVersion::V21,
        version => {
            return Err(format!(
                "Unsupported Optimuse1 Room schema version {version}; Optimuse1 and Optimuse first diverge at schema version {OPTIMUSE1_ROOM_SCHEMA_DIVERGENCE_VERSION}, and explicit archive bridges exist for schemas 10, 20, and 21.",
            ))
        }
    };
    let bridge = match sourceSchemaVersion {
        Optimuse1RoomSchemaVersion::V10 => {
            Optimuse1ToOptimuseChatArchiveBridge::Optimuse1RoomV10ToOptimuseSqliteV27
        }
        Optimuse1RoomSchemaVersion::V20 => {
            Optimuse1ToOptimuseChatArchiveBridge::Optimuse1RoomV20ToOptimuseSqliteV27
        }
        Optimuse1RoomSchemaVersion::V21 => {
            Optimuse1ToOptimuseChatArchiveBridge::Optimuse1RoomV21ToOptimuseSqliteV27
        }
    };
    let targetSchemaVersion = bridge.optimuseTargetSchemaVersion();
    if targetSchemaVersion != OPTIMUSE_SQLITE_CURRENT_SCHEMA_VERSION {
        return Err(format!(
            "Optimuse1 Room schema {} requires an explicit bridge to Optimuse SQLite schema {targetSchemaVersion}, but the current Optimuse SQLite schema is {OPTIMUSE_SQLITE_CURRENT_SCHEMA_VERSION}.",
            sourceSchemaVersion.sqliteUserVersion(),
        ));
    }
    Ok(bridge)
}

/// Reads the SQLite user version written by Optimuse1 Room.
fn readOptimuse1RoomSchemaVersion(
    connection: &mut dyn RuntimeSqliteConnection,
) -> Result<i32, String> {
    let rows = connection
        .query("PRAGMA user_version", Vec::new())
        .map_err(|error| error.to_string())?;
    let row = rows
        .first()
        .ok_or_else(|| "Optimuse1 Room schema version query returned no row".to_string())?;
    let version = row
        .valueAt(0)
        .map_err(|error| error.to_string())?
        .asI64()
        .map_err(|error| format!("Optimuse1 Room schema version: {error}"))?;
    i32::try_from(version)
        .map_err(|_| format!("Optimuse1 Room schema version does not fit i32: {version}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    use optimuse_host_api::{
        HostError, HostResult, RuntimeSqliteTransaction, SqliteRow, SqliteValue,
    };
    use rusqlite::types::Value as RusqliteValue;

    /// Adapts an in-memory rusqlite database to the runtime SQLite connection contract.
    struct TestSqliteConnection {
        connection: rusqlite::Connection,
    }

    impl TestSqliteConnection {
        /// Creates an empty in-memory SQLite connection for one migration test.
        fn new() -> Self {
            Self {
                connection: rusqlite::Connection::open_in_memory()
                    .expect("test SQLite connection must open"),
            }
        }

        /// Executes test setup SQL directly against the in-memory SQLite connection.
        fn executeBatch(&mut self, sql: &str) {
            self.connection
                .execute_batch(sql)
                .expect("test SQLite setup SQL must execute");
        }
    }

    impl RuntimeSqliteConnection for TestSqliteConnection {
        /// Executes a batch through the test SQLite connection.
        fn executeBatch(&mut self, sql: &str) -> HostResult<()> {
            self.connection
                .execute_batch(sql)
                .map_err(|error| HostError::new(error.to_string()))
        }

        /// Executes one parameterized statement through the test SQLite connection.
        fn execute(&mut self, sql: &str, params: Vec<SqliteValue>) -> HostResult<usize> {
            self.connection
                .execute(
                    sql,
                    rusqlite::params_from_iter(params.into_iter().map(toRusqliteValue)),
                )
                .map_err(|error| HostError::new(error.to_string()))
        }

        /// Queries rows through the test SQLite connection.
        fn query(&mut self, sql: &str, params: Vec<SqliteValue>) -> HostResult<Vec<SqliteRow>> {
            let mut statement = self
                .connection
                .prepare(sql)
                .map_err(|error| HostError::new(error.to_string()))?;
            let columns = statement
                .column_names()
                .into_iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>();
            let mut rows = statement
                .query(rusqlite::params_from_iter(
                    params.into_iter().map(toRusqliteValue),
                ))
                .map_err(|error| HostError::new(error.to_string()))?;
            let mut result = Vec::new();
            while let Some(row) = rows
                .next()
                .map_err(|error| HostError::new(error.to_string()))?
            {
                let values = (0..columns.len())
                    .map(|index| {
                        row.get::<_, RusqliteValue>(index)
                            .map(fromRusqliteValue)
                            .map_err(|error| HostError::new(error.to_string()))
                    })
                    .collect::<HostResult<Vec<_>>>()?;
                result.push(SqliteRow {
                    columns: columns.clone(),
                    values,
                });
            }
            Ok(result)
        }

        /// Returns the last row identifier assigned by the test SQLite connection.
        fn lastInsertRowId(&self) -> HostResult<i64> {
            Ok(self.connection.last_insert_rowid())
        }

        /// Declares transactions unavailable because these migration tests use batch execution.
        fn beginTransaction(&mut self) -> HostResult<Box<dyn RuntimeSqliteTransaction + '_>> {
            Err(HostError::new(
                "Test SQLite migration adapter does not use transactions",
            ))
        }
    }

    /// Converts one runtime SQLite parameter to the rusqlite representation.
    fn toRusqliteValue(value: SqliteValue) -> RusqliteValue {
        match value {
            SqliteValue::Null => RusqliteValue::Null,
            SqliteValue::Integer(value) => RusqliteValue::Integer(value),
            SqliteValue::Real(value) => RusqliteValue::Real(value),
            SqliteValue::Text(value) => RusqliteValue::Text(value),
            SqliteValue::Blob(value) => RusqliteValue::Blob(value),
        }
    }

    /// Converts one rusqlite query value to the runtime SQLite representation.
    fn fromRusqliteValue(value: RusqliteValue) -> SqliteValue {
        match value {
            RusqliteValue::Null => SqliteValue::Null,
            RusqliteValue::Integer(value) => SqliteValue::Integer(value),
            RusqliteValue::Real(value) => SqliteValue::Real(value),
            RusqliteValue::Text(value) => SqliteValue::Text(value),
            RusqliteValue::Blob(value) => SqliteValue::Blob(value),
        }
    }

    /// Selects the exact archive bridge for an Optimuse1 version-10 Room database.
    #[test]
    fn accepts_optimuse1_room_10() {
        let mut connection = TestSqliteConnection::new();
        connection.executeBatch(
            r#"
            CREATE TABLE chats (
                id TEXT NOT NULL PRIMARY KEY,
                title TEXT NOT NULL,
                createdAt INTEGER NOT NULL,
                updatedAt INTEGER NOT NULL,
                inputTokens INTEGER NOT NULL,
                outputTokens INTEGER NOT NULL,
                currentWindowSize INTEGER NOT NULL,
                "group" TEXT,
                displayOrder INTEGER NOT NULL,
                workspace TEXT,
                parentChatId TEXT,
                characterCardName TEXT,
                locked INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE messages (
                messageId INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                chatId TEXT NOT NULL,
                sender TEXT NOT NULL,
                content TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                orderIndex INTEGER NOT NULL,
                roleName TEXT NOT NULL,
                provider TEXT NOT NULL DEFAULT '',
                modelName TEXT NOT NULL DEFAULT ''
            );
            PRAGMA user_version = 10;
            "#,
        );

        let bridge = prepareOptimuse1RoomImport(&mut connection)
            .expect("Optimuse1 schema 10 must resolve its explicit archive bridge");

        assert_eq!(
            bridge,
            Optimuse1ToOptimuseChatArchiveBridge::Optimuse1RoomV10ToOptimuseSqliteV27
        );
        assert_eq!(bridge.optimuseTargetSchemaVersion(), 27);
        assert_eq!(
            readOptimuse1RoomSchemaVersion(&mut connection).expect("schema version must be readable"),
            10
        );
    }

    /// Selects the version-20 to version-26 bridge without rewriting the source schema.
    #[test]
    fn accepts_optimuse1_room_20() {
        let mut connection = TestSqliteConnection::new();
        connection.executeBatch(
            "CREATE TABLE chats (id TEXT NOT NULL PRIMARY KEY, pinned INTEGER NOT NULL DEFAULT 0); PRAGMA user_version = 20;",
        );

        let bridge = prepareOptimuse1RoomImport(&mut connection)
            .expect("Optimuse1 schema 20 must select the version-20 to version-26 bridge");

        assert_eq!(
            bridge,
            Optimuse1ToOptimuseChatArchiveBridge::Optimuse1RoomV20ToOptimuseSqliteV27
        );
        assert_eq!(bridge.optimuseTargetSchemaVersion(), 27);
        assert_eq!(
            readOptimuse1RoomSchemaVersion(&mut connection).expect("schema version must be readable"),
            20
        );
    }

    /// Rejects an Optimuse1 source schema outside the explicit archive bridges.
    #[test]
    fn rejects_unsupported_optimuse1_room_schema_version() {
        let mut connection = TestSqliteConnection::new();
        connection.executeBatch("PRAGMA user_version = 19;");

        let error = prepareOptimuse1RoomImport(&mut connection)
            .expect_err("unsupported Optimuse1 schemas must not enter an archive bridge");

        assert_eq!(
            error,
            "Unsupported Optimuse1 Room schema version 19; Optimuse1 and Optimuse first diverge at schema version 20, and explicit archive bridges exist for schemas 10, 20, and 21."
        );
    }

    /// Selects the explicit archive bridge for the latest Optimuse1 Room schema.
    #[test]
    fn accepts_optimuse1_room_21() {
        let mut connection = TestSqliteConnection::new();
        connection.executeBatch(
            "CREATE TABLE chats (id TEXT NOT NULL PRIMARY KEY, pinned INTEGER NOT NULL DEFAULT 0); PRAGMA user_version = 21;",
        );

        let bridge = prepareOptimuse1RoomImport(&mut connection)
            .expect("Optimuse1 schema 21 must select the latest explicit archive bridge");

        assert_eq!(
            bridge,
            Optimuse1ToOptimuseChatArchiveBridge::Optimuse1RoomV21ToOptimuseSqliteV27
        );
        assert_eq!(bridge.optimuseTargetSchemaVersion(), 27);
    }
}
