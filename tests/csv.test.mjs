// RFC 4180 parser/writer: quoting, embedded delimiters and newlines,
// CRLF, BOM, bare quotes, and the parse -> write round trip. The CSV
// layer is the pipeline's foundation; a mis-split cell corrupts every
// downstream mapping decision.
import assert from "node:assert/strict";
import test from "node:test";
import { encodeCell, parseCsv, writeCsv } from "../dist/index.js";

test("parses a plain CSV into rows and cells", () => {
  const { rows } = parseCsv("a,b,c\n1,2,3\n");
  assert.deepEqual(rows, [["a", "b", "c"], ["1", "2", "3"]]);
});

test("quoted fields keep embedded delimiters, quotes and newlines", () => {
  const { rows } = parseCsv('name,note\n"Doe, Jane","says ""hi""\nsecond line"\n');
  assert.deepEqual(rows, [
    ["name", "note"],
    ["Doe, Jane", 'says "hi"\nsecond line'],
  ]);
});

test("CRLF/CR line endings and a missing final newline parse like LF", () => {
  assert.deepEqual(parseCsv("a,b\r\n1,2\r\n").rows, [["a", "b"], ["1", "2"]]);
  assert.deepEqual(parseCsv("a,b\r1,2\r").rows, [["a", "b"], ["1", "2"]]);

  assert.deepEqual(parseCsv("a,b\n1,2").rows, [["a", "b"], ["1", "2"]]);
});

test("a UTF-8 BOM never leaks into the first header", () => {
  const { rows } = parseCsv("\uFEFFemail,name\nx@example.test,X\n");
  assert.equal(rows[0][0], "email");
});

test("empty cells survive; a bare quote mid-field is kept literally", () => {
  assert.deepEqual(parseCsv('a,,c\n"",2,\n').rows, [["a", "", "c"], ["", "2", ""]]);

  // Real exports emit this ('5" pipe'); import tools must not choke.
  const { rows } = parseCsv('size\n5" pipe\n');
  assert.deepEqual(rows[1], ['5" pipe']);
});

test("trailing fully-empty rows are dropped, interior ones are kept", () => {
  const { rows } = parseCsv("a,b\n1,2\n,\n3,4\n,\n,\n");
  assert.deepEqual(rows, [["a", "b"], ["1", "2"], ["", ""], ["3", "4"]]);
});

test("custom delimiters work; multi-character delimiters are rejected", () => {
  assert.deepEqual(parseCsv("a;b\n1;2\n", { delimiter: ";" }).rows, [["a", "b"], ["1", "2"]]);
  assert.deepEqual(parseCsv("a\tb\n1\t2\n", { delimiter: "\t" }).rows, [["a", "b"], ["1", "2"]]);
  assert.throws(() => parseCsv("a,b\n", { delimiter: ",," }), /single character/);
});

test("encodeCell quotes only when needed; write -> parse round-trips hostile content", () => {
  assert.equal(encodeCell("plain"), "plain");
  assert.equal(encodeCell("a,b"), '"a,b"');
  assert.equal(encodeCell('say "hi"'), '"say ""hi"""');
  assert.equal(encodeCell("two\nlines"), '"two\nlines"');

  const rows = [
    ["h1", "h,2", 'h"3'],
    ["v\n1", "", "  padded  "],
    ["ünïcode", "汉字", "🎉"],
  ];
  const text = writeCsv(rows);
  assert.deepEqual(parseCsv(text).rows, rows);
});
