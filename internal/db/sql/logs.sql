-- name: CreateLog :one
INSERT INTO logs (
    id,
    session_id,
    timestamp,
    level,
    message,
    attributes,
    created_at
) VALUES (
    ?,
    ?,
    ?,
    ?,
    ?,
    ?,
    ?
) RETURNING *;

-- name: ListLogsBySession :many
SELECT * FROM logs
WHERE session_id = ?
ORDER BY timestamp ASC;

-- name: ListAllLogs :many
SELECT * FROM logs
ORDER BY timestamp DESC
LIMIT ?;
