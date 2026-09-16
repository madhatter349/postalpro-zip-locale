/**
 * Unit tests for the pure helpers in scripts/update.js.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parsePageDate,
  normalizeRows,
  validateRecords,
  diffDatasets,
  toCsv,
  cleanCell,
  recordKey,
  AREA_CODES,
} from "../scripts/update.js";

test("parsePageDate handles USPS's published dates", () => {
  assert.equal(parsePageDate("September 08, 2026").iso, "2026-09-08");
  assert.equal(parsePageDate("September 8, 2026").iso, "2026-09-08");
  assert.equal(parsePageDate("July 01, 2026").iso, "2026-07-01");
  assert.equal(parsePageDate("not a date"), null);
  assert.equal(parsePageDate("February 30, 2026"), null);
  assert.equal(parsePageDate(""), null);
});

test("cleanCell trims and nulls blanks", () => {
  assert.equal(cleanCell("  ADJUNTAS   "), "ADJUNTAS");
  assert.equal(cleanCell("   "), null);
  assert.equal(cleanCell(null), null);
  assert.equal(cleanCell(0), "0");
});

test("normalizeRows trims, pads ZIPs, and derives area_code", () => {
  const rows = [
    {
      "AREA NAME": "SOUTHERN            ",
      "DISTRICT NAME": "PUERTO RICO         ",
      "DISTRICT NO": "006",
      "DELIVERY ZIPCODE": "601",
      "LOCALE NAME": "ADJUNTAS                    ",
      "PHYSICAL DELV ADDR": "37 CALLE MUNOZ RIVERA",
      "PHYSICAL CITY": "ADJUNTAS",
      "PHYSICAL STATE": "pr",
      "PHYSICAL ZIP": "00601",
      "PHYSICAL ZIP 4": "9998",
      "ZIP CLASS CODE": " ",
      "LOCALE KEY": "V17135",
      "LOCALE TYPE": "P",
    },
    {
      "AREA NAME": "ATLANTIC",
      "AREA CODE": "4B",
      "DISTRICT NAME": "CONNECTICUT",
      "DISTRICT NO": "060",
      "DELIVERY ZIPCODE": "06006",
      "LOCALE NAME": "WINDSOR",
      "PHYSICAL DELV ADDR": "245 BROAD ST",
      "PHYSICAL CITY": "WINDSOR",
      "PHYSICAL STATE": "CT",
      "PHYSICAL ZIP": "06095",
      "PHYSICAL ZIP 4": "9998",
    },
  ];

  const records = normalizeRows(rows);
  assert.equal(records.length, 2);

  assert.equal(records[0].area_name, "SOUTHERN");
  assert.equal(records[0].area_code, AREA_CODES.SOUTHERN);
  assert.equal(records[0].delivery_zipcode, "00601");
  assert.equal(records[0].physical_state, "PR");
  assert.equal(records[0].zip_class_code, null);
  assert.equal(records[0].locale_key, "V17135");

  // explicit AREA CODE wins when present
  assert.equal(records[1].area_code, "4B");
  assert.equal(records[1].locale_key, null);
});

test("normalizeRows drops rows without a delivery ZIP", () => {
  const records = normalizeRows([
    { "AREA NAME": "SOUTHERN", "DELIVERY ZIPCODE": null, "LOCALE NAME": "X" },
    { "AREA NAME": "SOUTHERN", "DELIVERY ZIPCODE": "00601", "LOCALE NAME": "Y" },
  ]);
  assert.equal(records.length, 1);
  assert.equal(records[0].locale_name, "Y");
});

test("validateRecords flags bad data and accepts a healthy set", () => {
  const STATES = `AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY`.split(" ");

  const good = Array.from({ length: 35000 }, (_, i) => ({
    area_name: "SOUTHERN",
    area_code: "4G",
    district_name: "TEST",
    district_no: "001",
    delivery_zipcode: String(10000 + (i % 30000)).padStart(5, "0"),
    locale_name: "LOCALE",
    physical_delivery_address: "1 MAIN ST",
    physical_city: "CITY",
    physical_state: STATES[i % STATES.length],
    physical_zip: "10001",
    physical_zip4: "0001",
    zip_class_code: null,
    locale_key: null,
    locale_type: null,
  }));

  assert.deepEqual(validateRecords(good), []);

  const tooSmall = validateRecords(good.slice(0, 10));
  assert.match(tooSmall.join(" "), /minimum 35000/);

  const badZip = structuredClone(good);
  badZip[0].delivery_zipcode = "ABCDE";
  assert.match(validateRecords(badZip).join(" "), /invalid delivery_zipcode/);

  const badState = structuredClone(good);
  badState[0].physical_state = "New York";
  assert.match(validateRecords(badState).join(" "), /invalid physical_state/);
});

test("diffDatasets detects added, removed, and changed records", () => {
  const base = {
    area_name: "SOUTHERN",
    area_code: "4G",
    district_name: "TEST",
    district_no: "001",
    delivery_zipcode: "00601",
    locale_name: "ADJUNTAS",
    physical_delivery_address: "1 MAIN ST",
    physical_city: "ADJUNTAS",
    physical_state: "PR",
    physical_zip: "00601",
    physical_zip4: "9998",
    zip_class_code: null,
    locale_key: null,
    locale_type: null,
  };

  const before = [
    { ...base },
    { ...base, delivery_zipcode: "00602", locale_name: "REMOVED" },
  ];
  const after = [
    { ...base, physical_delivery_address: "2 MAIN ST" },
    { ...base, delivery_zipcode: "00603", locale_name: "ADDED" },
  ];

  const diff = diffDatasets(before, after);
  assert.equal(diff.added, 1);
  assert.equal(diff.removed, 1);
  assert.equal(diff.changed, 1);
  assert.equal(diff.truncated, false);
  assert.equal(diff.changed_records[0].key, recordKey(base));
});

test("diffDatasets ignores additive schema changes", () => {
  const before = [
    {
      delivery_zipcode: "00601",
      locale_name: "ADJUNTAS",
      physical_zip4: "9998",
      physical_state: "PR",
    },
  ];
  const after = [{ ...before[0], zip_class_code: "U", locale_key: "V1" }];
  const diff = diffDatasets(before, after);
  assert.equal(diff.changed, 0);
});

test("toCsv escapes RFC 4180 special characters", () => {
  const csv = toCsv(
    [{ a: 'He said "hi"', b: "x,y", c: "plain", d: null }],
    ["a", "b", "c", "d"]
  );
  assert.equal(csv, 'a,b,c,d\r\n"He said ""hi""","x,y",plain,\r\n');
});
