-- +goose Up
-- +goose StatementBegin
-- Sessions
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    parent_session_id TEXT,
    title TEXT NOT NULL,
    message_count INTEGER NOT NULL DEFAULT 0 CHECK (message_count >= 0),
    prompt_tokens INTEGER NOT NULL DEFAULT 0 CHECK (prompt_tokens >= 0),
    completion_tokens INTEGER NOT NULL DEFAULT 0 CHECK (completion_tokens >= 0),
    cost REAL NOT NULL DEFAULT 0.0 CHECK (cost >= 0.0),
    summary TEXT,
    summarized_at TEXT,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z', 'now')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z', 'now'))
);

CREATE TRIGGER IF NOT EXISTS update_sessions_updated_at
AFTER UPDATE ON sessions
BEGIN
UPDATE sessions SET updated_at = strftime('%Y-%m-%dT%H:%M:%f000Z', 'now')
WHERE id = new.id;
END;

-- Files
CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    path TEXT NOT NULL,
    content TEXT NOT NULL,
    version TEXT NOT NULL,
    is_new INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z', 'now')),
    FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE CASCADE,
    UNIQUE(path, session_id, version)
);

CREATE INDEX IF NOT EXISTS idx_files_session_id ON files (session_id);
CREATE INDEX IF NOT EXISTS idx_files_path ON files (path);

CREATE TRIGGER IF NOT EXISTS update_files_updated_at
AFTER UPDATE ON files
BEGIN
UPDATE files SET updated_at = strftime('%Y-%m-%dT%H:%M:%f000Z', 'now')
WHERE id = new.id;
END;

-- Messages
CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    parts TEXT NOT NULL default '[]',
    model TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z', 'now')),
    finished_at TEXT,
    FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages (session_id);

CREATE TRIGGER IF NOT EXISTS update_messages_updated_at
AFTER UPDATE ON messages
BEGIN
UPDATE messages SET updated_at = strftime('%Y-%m-%dT%H:%M:%f000Z', 'now')
WHERE id = new.id;
END;

CREATE TRIGGER IF NOT EXISTS update_session_message_count_on_insert
AFTER INSERT ON messages
BEGIN
UPDATE sessions SET
    message_count = message_count + 1
WHERE id = new.session_id;
END;

CREATE TRIGGER IF NOT EXISTS update_session_message_count_on_delete
AFTER DELETE ON messages
BEGIN
UPDATE sessions SET
    message_count = message_count - 1
WHERE id = old.session_id;
END;

-- Logs
CREATE TABLE IF NOT EXISTS logs (
    id TEXT PRIMARY KEY,
    session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
    timestamp TEXT NOT NULL,
    level TEXT NOT NULL,
    message TEXT NOT NULL,
    attributes TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z', 'now'))
);

CREATE INDEX logs_session_id_idx ON logs(session_id);
CREATE INDEX logs_timestamp_idx ON logs(timestamp);

CREATE TRIGGER IF NOT EXISTS update_logs_updated_at
AFTER UPDATE ON logs
BEGIN
UPDATE logs SET updated_at = strftime('%Y-%m-%dT%H:%M:%f000Z', 'now')
WHERE id = new.id;
END;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TRIGGER IF EXISTS update_sessions_updated_at;
DROP TRIGGER IF EXISTS update_messages_updated_at;
DROP TRIGGER IF EXISTS update_files_updated_at;
DROP TRIGGER IF EXISTS update_logs_updated_at;

DROP TRIGGER IF EXISTS update_session_message_count_on_delete;
DROP TRIGGER IF EXISTS update_session_message_count_on_insert;

DROP TABLE IF EXISTS logs;
DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS files;
DROP TABLE IF EXISTS sessions;
-- +goose StatementEnd
