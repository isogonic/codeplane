-- sqlfluff:dialect:sqlite
-- name: CreateSession :one
INSERT INTO sessions (
    id,
    title,
    message_count,
    tokens,
    cost,
    updated_at,
    created_at
) VALUES (
    ?,
    ?,
    ?,
    ?,
    ?,
    strftime('%s', 'now'),
    strftime('%s', 'now')
) RETURNING *;

-- name: GetSessionByID :one
SELECT *
FROM sessions
WHERE id = ? LIMIT 1;

-- name: ListSessions :many
SELECT *
FROM sessions
ORDER BY created_at DESC;

-- name: UpdateSession :one
UPDATE sessions
SET
    title = ?,
    tokens = ?,
    cost = ?
WHERE id = ?
RETURNING *;


-- name: DeleteSession :exec
DELETE FROM sessions
WHERE id = ?;
