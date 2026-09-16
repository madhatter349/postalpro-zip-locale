/**
 * Integration tests: validate the committed data artifacts are internally
 * consistent. Runs in CI after every data update and on every push/PR.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import * as url from "url";
import Database from "better-sqlite3";
import { CSV_FIELDS } from "../scripts/update.js";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA = path.join(ROOT, "data");

const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));

const index = readJson(path.join(DATA, "index.json"));
const records = readJson(path.join(DATA, "zip_locale_detail.json"));

test("index.json is internally consistent", () => {
  assert.equal(index.schema_version, 2);
  assert.equal(index.total_records, records.length);
  assert.equal(
    index.unique_zipcodes,
    new Set(records.map(r => r.delivery_zipcode)).size
  );
  assert.equal(index.state_count, index.states.length);
  assert.match(index.last_updated_iso || "", /^\d{4}-\d{2}-\d{2}$/);
  assert.match(index.source.sha256 || "", /^[0-9a-f]{64}$/);

  const counts = Object.values(index.state_breakdown).reduce((a, b) => a + b, 0);
  assert.equal(counts, index.states.length);
});

test("full dataset records match the public schema", () => {
  assert.ok(records.length >= 35000, `only ${records.length} records`);

  for (const record of records) {
    assert.match(record.delivery_zipcode, /^\d{5}$/);
    assert.ok(record.locale_name, `missing locale_name for ${record.delivery_zipcode}`);
    assert.equal(typeof record.area_name, "string");
    assert.equal(typeof record.area_code, "string");
    assert.equal(typeof record.district_name, "string");
    if (record.physical_state != null) {
      assert.match(record.physical_state, /^[A-Z]{2}$/);
    }
    if (record.physical_zip != null) {
      assert.match(record.physical_zip, /^\d{5}$/);
    }
  }
});

test("state files match index counts and contain their own state", () => {
  for (const entry of index.states) {
    const file = path.join(DATA, "states", `${entry.state}.json`);
    assert.ok(fs.existsSync(file), `missing ${entry.state}.json`);
    const rows = readJson(file);
    assert.equal(rows.length, entry.count, `${entry.state} count mismatch`);

    if (entry.state !== "UNKNOWN") {
      for (const row of rows) {
        assert.equal(row.physical_state, entry.state);
      }
    }
  }
});

test("CSV files exist for every state and the full dataset", () => {
  for (const entry of index.states) {
    const file = path.join(DATA, "csv", `${entry.state}.csv`);
    assert.ok(fs.existsSync(file), `missing ${entry.state}.csv`);
    const text = fs.readFileSync(file, "utf8");
    assert.equal(text.slice(0, text.indexOf("\r\n")), CSV_FIELDS.join(","));
    const lines = text.trimEnd().split("\r\n").length;
    assert.equal(lines, entry.count + 1, `${entry.state}.csv row count`);
  }
  assert.ok(fs.existsSync(path.join(DATA, "csv", "zip_locale_detail.csv")));
});

test("SQLite database mirrors the full dataset", () => {
  const db = new Database(path.join(DATA, "zip_locale_detail.sqlite"), {
    readonly: true,
  });
  try {
    const count = db.prepare("SELECT COUNT(*) AS c FROM records").get().c;
    assert.equal(count, records.length);

    const meta = Object.fromEntries(
      db.prepare("SELECT key, value FROM meta").all().map(r => [r.key, r.value])
    );
    assert.equal(meta.total_records, String(records.length));
    assert.equal(meta.source_sha256, index.source.sha256);

    const sample = db
      .prepare("SELECT * FROM records WHERE delivery_zipcode = ?")
      .get(records[0].delivery_zipcode);
    assert.ok(sample);
  } finally {
    db.close();
  }
});

test("health, changes, and history are consistent", () => {
  const health = readJson(path.join(DATA, "health.json"));
  assert.equal(health.status, "ok");
  assert.equal(health.total_records, records.length);
  assert.equal(health.last_updated, index.last_updated);

  const changes = readJson(path.join(DATA, "changes.json"));
  assert.equal(changes.to_total, records.length);
  assert.equal(changes.added_records.length, Math.min(changes.added, 5000));
  assert.equal(changes.removed_records.length, Math.min(changes.removed, 5000));
  assert.equal(changes.changed_records.length, Math.min(changes.changed, 5000));

  const history = readJson(path.join(DATA, "history.json"));
  assert.ok(Array.isArray(history) && history.length >= 1);
  const last = history[history.length - 1];
  assert.equal(last.published, index.last_updated);
  assert.equal(last.total_records, records.length);
});

test("machine-readable specs are valid JSON", () => {
  const schema = readJson(path.join(DATA, "schema.json"));
  assert.ok(schema.$defs.record);

  const openapi = readJson(path.join(ROOT, "openapi.json"));
  assert.equal(openapi.openapi, "3.1.0");
  assert.ok(openapi.paths["/data/zip_locale_detail.json"]);

  assert.ok(fs.existsSync(path.join(ROOT, "sitemap.xml")));
  assert.ok(fs.existsSync(path.join(ROOT, "robots.txt")));
  assert.ok(fs.existsSync(path.join(ROOT, "LICENSE")));
});
