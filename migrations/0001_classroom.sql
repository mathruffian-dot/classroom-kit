-- All classroom persistence lives in this D1 database. No public Data API.
CREATE TABLE kit_meta (
  instance_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 0,
  secret TEXT NOT NULL DEFAULT '',
  write_token TEXT NOT NULL DEFAULT ''
);
CREATE TABLE kit_lessons (instance_id TEXT NOT NULL, id TEXT NOT NULL, parent_id TEXT NOT NULL DEFAULT '', payload TEXT NOT NULL CHECK(json_valid(payload)), PRIMARY KEY(instance_id,id));
CREATE TABLE kit_classes (instance_id TEXT NOT NULL, id TEXT NOT NULL, parent_id TEXT NOT NULL DEFAULT '', payload TEXT NOT NULL CHECK(json_valid(payload)), PRIMARY KEY(instance_id,id));
CREATE TABLE kit_students (instance_id TEXT NOT NULL, id TEXT NOT NULL, parent_id TEXT NOT NULL DEFAULT '', payload TEXT NOT NULL CHECK(json_valid(payload)), PRIMARY KEY(instance_id,id));
CREATE TABLE kit_sessions (instance_id TEXT NOT NULL, id TEXT NOT NULL, parent_id TEXT NOT NULL DEFAULT '', payload TEXT NOT NULL CHECK(json_valid(payload)), PRIMARY KEY(instance_id,id));
CREATE TABLE kit_answers (instance_id TEXT NOT NULL, id TEXT NOT NULL, parent_id TEXT NOT NULL DEFAULT '', payload TEXT NOT NULL CHECK(json_valid(payload)), PRIMARY KEY(instance_id,id));
CREATE UNIQUE INDEX kit_answer_submission ON kit_answers(instance_id,parent_id,json_extract(payload,'$.userId'),json_extract(payload,'$.submissionId'));
CREATE INDEX kit_answers_session ON kit_answers(instance_id,parent_id);
CREATE TABLE kit_whiteboard (instance_id TEXT NOT NULL, id TEXT NOT NULL, parent_id TEXT NOT NULL DEFAULT '', payload TEXT NOT NULL CHECK(json_valid(payload)), PRIMARY KEY(instance_id,id));
CREATE TABLE kit_logins (instance_id TEXT NOT NULL, id TEXT NOT NULL, parent_id TEXT NOT NULL DEFAULT '', payload TEXT NOT NULL CHECK(json_valid(payload)), PRIMARY KEY(instance_id,id));
CREATE TABLE kit_ai_usage (instance_id TEXT NOT NULL, id TEXT NOT NULL, parent_id TEXT NOT NULL DEFAULT '', payload TEXT NOT NULL CHECK(json_valid(payload)), PRIMARY KEY(instance_id,id));
CREATE TABLE kit_login_limits (instance_id TEXT NOT NULL, ip_hash TEXT NOT NULL, window_start INTEGER NOT NULL, attempts INTEGER NOT NULL, PRIMARY KEY(instance_id,ip_hash));
CREATE TABLE kit_files (
  instance_id TEXT NOT NULL,
  id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  metadata TEXT NOT NULL CHECK(json_valid(metadata)),
  bytes INTEGER NOT NULL CHECK(bytes > 0 AND bytes <= 1048576),
  data BLOB NOT NULL,
  PRIMARY KEY(instance_id,id),
  FOREIGN KEY(instance_id,session_id) REFERENCES kit_sessions(instance_id,id) ON DELETE CASCADE
);
CREATE INDEX kit_files_session ON kit_files(instance_id,session_id,user_id);
