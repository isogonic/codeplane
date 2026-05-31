-- Adds session-level custom metadata support. Each session can store arbitrary
-- key-value pairs that are available through the API and SDK.
ALTER TABLE `session` ADD COLUMN `metadata` text;
