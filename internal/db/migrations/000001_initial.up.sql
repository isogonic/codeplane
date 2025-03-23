-- sqlfluff:dialect:sqlite
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    message_count INTEGER NOT NULL DEFAULT 0 CHECK (message_count >= 0),
    tokens INTEGER NOT NULL DEFAULT 0 CHECK (tokens >= 0),
    cost REAL NOT NULL DEFAULT 0.0 CHECK (cost >= 0.0),
    updated_at INTEGER NOT NULL,  -- Unix timestamp in milliseconds
    created_at INTEGER NOT NULL   -- Unix timestamp in milliseconds
);

CREATE TRIGGER IF NOT EXISTS update_sessions_updated_at
AFTER UPDATE ON sessions
BEGIN
UPDATE sessions SET updated_at = strftime('%s', 'now')
WHERE id = new.id;
END;
