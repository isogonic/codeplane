-- name: CreateSession :one
INSERT INTO sessions (
    id,
    parent_session_id,
    title,
    message_count,
    prompt_tokens,
    completion_tokens,
    cost,
    updated_at,
    created_at
) VALUES (
    ?,
    ?,
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
WHERE parent_session_id is NULL
ORDER BY created_at DESC;

-- name: UpdateSession :one
UPDATE sessions
SET
    title = ?,
    prompt_tokens = ?,
    completion_tokens = ?,
    cost = ?
WHERE id = ?
RETURNING *;


-- name: DeleteSession :exec
DELETE FROM sessions
WHERE id = ?;
