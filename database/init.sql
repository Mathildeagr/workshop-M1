-- Rôles
CREATE TABLE roles (
                       id   SERIAL PRIMARY KEY,
                       name VARCHAR(30) UNIQUE NOT NULL
);

INSERT INTO roles (name) VALUES ('admin'), ('superviseur'), ('lecteur');

-- Utilisateurs
CREATE TABLE users (
                       id            SERIAL PRIMARY KEY,
                       username      VARCHAR(50) UNIQUE NOT NULL,
                       password_hash VARCHAR(255) NOT NULL,
                       role_id       INT NOT NULL REFERENCES roles(id),
                       created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);