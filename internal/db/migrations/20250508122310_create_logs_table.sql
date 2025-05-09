-- +goose Up
CREATE TABLE logs (
    id TEXT PRIMARY KEY,
    session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
    timestamp INTEGER NOT NULL,
    level TEXT NOT NULL,
    message TEXT NOT NULL,
    attributes TEXT,
    created_at INTEGER NOT NULL
);

CREATE INDEX logs_session_id_idx ON logs(session_id);
CREATE INDEX logs_timestamp_idx ON logs(timestamp);

-- +goose Down
DROP TABLE logs;