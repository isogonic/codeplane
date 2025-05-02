-- +goose Up
-- +goose StatementBegin
ALTER TABLE sessions ADD COLUMN summary TEXT;
ALTER TABLE sessions ADD COLUMN summarized_at INTEGER;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE sessions DROP COLUMN summarized_at;
ALTER TABLE sessions DROP COLUMN summary;
-- +goose StatementEnd