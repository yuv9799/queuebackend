import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('database initialization creates a missing configured directory', (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kims-db-init-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const databaseDirectory = path.join(tempDir, 'persistent', 'sqlite');
  const databasePath = path.join(databaseDirectory, 'queue.db');
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      'const { db, migrate, get } = await import(process.env.DB_MODULE_URL); migrate(); if (!get("SELECT name FROM sqlite_master WHERE type = ? AND name = ?", "table", "departments")) process.exitCode = 1; db.close();',
    ],
    {
      cwd: path.resolve(__dirname, '..'),
      env: {
        ...process.env,
        DB_MODULE_URL: pathToFileURL(path.resolve(__dirname, '..', 'config', 'db.js')).href,
        DB_PATH: databasePath,
      },
      encoding: 'utf8',
    }
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.ok(fs.existsSync(databaseDirectory), 'configured database directory should be created');
  assert.ok(fs.existsSync(databasePath), 'SQLite should create the database in the configured directory');
});
