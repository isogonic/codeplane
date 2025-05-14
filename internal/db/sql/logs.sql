-- name: CreateLog :one
INSERT INTO logs (
    id,
    session_id,
    timestamp,
    level,
    message,
    attributes
) VALUES (
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
ORDER BY timestamp DESC;

-- name: ListAllLogs :many
SELECT * FROM logs
ORDER BY timestamp DESC
LIMIT ?;
