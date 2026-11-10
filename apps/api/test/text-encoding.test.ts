import test from "node:test";
import assert from "node:assert/strict";
import { decodeTextBytes } from "../src/services/text-encoding.js";

function utf16le(text: string, withBom = true): Uint8Array {
  const body = Buffer.from(text, "utf16le");
  return withBom
    ? new Uint8Array([0xff, 0xfe, ...body])
    : new Uint8Array(body);
}

function utf16be(text: string): Uint8Array {
  const littleEndian = Buffer.from(text, "utf16le");
  const bigEndian = Buffer.alloc(littleEndian.length);
  for (let i = 0; i < littleEndian.length; i += 2) {
    bigEndian[i] = littleEndian[i + 1] ?? 0;
    bigEndian[i + 1] = littleEndian[i] ?? 0;
  }
  return new Uint8Array([0xfe, 0xff, ...bigEndian]);
}

test("decodeTextBytes reads UTF-8 without a BOM", () => {
  const decoded = decodeTextBytes(new TextEncoder().encode("অসমীয়া পাঠ"));
  assert.equal(decoded.text, "অসমীয়া পাঠ");
  assert.equal(decoded.encoding, "utf-8");
  assert.equal(decoded.suspiciousBinary, false);
});

test("decodeTextBytes strips a UTF-8 BOM", () => {
  const bytes = new Uint8Array([
    0xef,
    0xbb,
    0xbf,
    ...new TextEncoder().encode("John loves Mary."),
  ]);
  const decoded = decodeTextBytes(bytes);
  assert.equal(decoded.text, "John loves Mary.");
  assert.equal(decoded.suspiciousBinary, false);
});

test("decodeTextBytes reads UTF-16LE with a BOM", () => {
  const decoded = decodeTextBytes(utf16le("অসমীয়া পাঠ"));
  assert.equal(decoded.text, "অসমীয়া পাঠ");
  assert.equal(decoded.encoding, "utf-16le");
  assert.equal(decoded.suspiciousBinary, false);
});

test("decodeTextBytes reads UTF-16BE with a BOM", () => {
  const decoded = decodeTextBytes(utf16be("অসমীয়া পাঠ"));
  assert.equal(decoded.text, "অসমীয়া পাঠ");
  assert.equal(decoded.encoding, "utf-16be");
  assert.equal(decoded.suspiciousBinary, false);
});

test("decodeTextBytes detects BOM-less UTF-16LE", () => {
  const decoded = decodeTextBytes(utf16le("Hello world", false));
  assert.equal(decoded.text, "Hello world");
  assert.equal(decoded.encoding, "utf-16le");
  assert.equal(decoded.suspiciousBinary, false);
});

test("decodeTextBytes detects BOM-less UTF-16LE Assamese", () => {
  const decoded = decodeTextBytes(utf16le("অসমীয়া পাঠ", false));
  assert.equal(decoded.text, "অসমীয়া পাঠ");
  assert.equal(decoded.encoding, "utf-16le");
  assert.equal(decoded.suspiciousBinary, false);
});

test("decodeTextBytes accepts legacy single-byte text", () => {
  const decoded = decodeTextBytes(new Uint8Array([0x63, 0x61, 0x66, 0xe9]));
  assert.equal(decoded.text, "café");
  assert.equal(decoded.encoding, "windows-1252");
  assert.equal(decoded.suspiciousBinary, false);
});

test("decodeTextBytes flags binary content", () => {
  const decoded = decodeTextBytes(
    new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]),
  );
  assert.equal(decoded.suspiciousBinary, true);
});
