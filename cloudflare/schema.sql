-- One row per file the api keeps in DATA_DIR (db.json, state-<uid>.json, secret, vapid.json...).
CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, body BLOB NOT NULL);
