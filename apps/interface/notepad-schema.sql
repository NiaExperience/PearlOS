-- Users Table
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(50) UNIQUE NOT NULL,
  organization_id VARCHAR(50) NOT NULL
);

-- Notes Table
CREATE TABLE notes (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  mode VARCHAR(20) CHECK (mode IN ('personal', 'work')),
  user_id VARCHAR(50) REFERENCES users(user_id),
  organization_id VARCHAR(50)
);

-- Sample Seed Data
INSERT INTO users (user_id, organization_id) VALUES ('paddy', 'NIA123');
INSERT INTO users (user_id, organization_id) VALUES ('himanshu', 'NIA123');
INSERT INTO users (user_id, organization_id) VALUES ('nitesh', 'ORG456');

INSERT INTO notes (title, content, mode, user_id, organization_id) VALUES ('Paddy Personal Note 1', 'This is a personal note for paddy.', 'personal', 'paddy', NULL);
INSERT INTO notes (title, content, mode, user_id, organization_id) VALUES ('Work Note 1', 'This is a work note for organization NIA123.', 'work', 'paddy', 'NIA123');
INSERT INTO notes (title, content, mode, user_id, organization_id) VALUES ('Nitesh Personal Note', 'This is a personal note for nitesh.', 'personal', 'nitesh', NULL);