// Copies the shared GDS library (gds\gdslib.bas, lines >= 8000) into every
// generator script and checks C64 BASIC V2 variable-name hygiene.
// Usage: node gds\sync_gdslib.mjs [--check] [file.bas ...]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const files = args.filter((a) => !a.startsWith("--"));
const targets = files.length
  ? files
  : fs.readdirSync(dir).filter((f) => /^gds_.*\.bas$/.test(f)).map((f) => path.join(dir, f));

const KEYWORDS = ["END", "FOR", "NEXT", "DATA", "INPUT#", "INPUT", "DIM", "READ", "LET", "GOTO", "RUN", "IF",
  "RESTORE", "GOSUB", "RETURN", "REM", "STOP", "ON", "WAIT", "LOAD", "SAVE", "VERIFY", "DEF", "POKE", "PRINT#",
  "PRINT", "CONT", "LIST", "CLR", "CMD", "SYSTEM", "SYS", "OPEN", "CLOSE", "GET", "NEW", "TAB(", "TO", "FN", "SPC(",
  "THEN", "NOT", "STEP", "AND", "OR", "SGN", "INT", "ABS", "USR", "FRE", "POS", "SQR", "RND", "LOG", "EXP", "COS",
  "SIN", "TAN", "ATN", "PEEK", "LEN", "STR$", "VAL", "ASC", "CHR$", "LEFT$", "RIGHT$", "MID$", "GO"];
const RESERVED_VARS = new Set(["ST", "TI", "TI$", "DS", "DS$"]);

// Names the shared library reads or writes on purpose.
const INTERFACE = new Set(`ER H T ZR PP PW PL FL VD VP NS PM FW FE LY LP LT GV GU GM GP GW RF R1 R2 R3 R4 G1 G2 G3 G4
CX CY CR TX TY TS$ PX PY PO PN$ RY LD DD PA$ PB$ PI TZ W EE ZZ QF$ QM QE QN QW QX QY`.split(/\s+/));

function scan(text) {
  const vars = [];
  const issues = [];
  let prev = "";
  for (let i = 0; i < text.length;) {
    const ch = text[i];
    if (ch === '"') {
      const end = text.indexOf('"', i + 1);
      i = end < 0 ? text.length : end + 1;
      prev = "";
      continue;
    }
    if (/[A-Z]/.test(ch)) {
      const kw = KEYWORDS.find((k) => text.startsWith(k, i));
      if (kw) {
        if (kw === "REM") return { vars, issues };
        if (prev === "var") issues.push(`keyword ${kw} glued to a variable`);
        i += kw.length;
        prev = "kw";
        if (kw === "DATA") {
          const colon = text.indexOf(":", i);
          i = colon < 0 ? text.length : colon;
        }
        continue;
      }
      let j = i + 1;
      while (j < text.length && /[A-Z0-9]/.test(text[j]) && !KEYWORDS.some((k) => text.startsWith(k, j))) j += 1;
      let name = text.slice(i, j);
      if (text[j] === "$" || text[j] === "%") { name += text[j]; j += 1; }
      vars.push(name);
      i = j;
      prev = "var";
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < text.length && /[0-9.]/.test(text[j])) j += 1;
      if (/E/.test(text[j] ?? "") && /[-+0-9]/.test(text[j + 1] ?? "")) {
        j += 2;
        while (j < text.length && /[0-9]/.test(text[j])) j += 1;
      }
      i = j;
      prev = "num";
      continue;
    }
    prev = "";
    i += 1;
  }
  return { vars, issues };
}

function parse(source) {
  return source.replace(/\r/g, "").split("\n").filter((l) => l.trim() !== "").map((line) => {
    const m = /^(\d+)\s?(.*)$/.exec(line);
    if (!m) throw new Error(`Line without a number: ${line}`);
    return { no: Number(m[1]), text: m[2], raw: line };
  });
}

const lib = parse(fs.readFileSync(path.join(dir, "gdslib.bas"), "utf8"));
const libNames = new Set();
let problems = 0;
const report = (where, msg) => { problems += 1; console.log(`${where}: ${msg}`); };

for (const l of lib) {
  if (l.no < 8000) report("gdslib.bas", `line ${l.no} below 8000`);
  if (l.raw.length > 100) report("gdslib.bas", `line ${l.no} longer than 100 characters`);
  const { vars, issues } = scan(l.text);
  issues.forEach((m) => report("gdslib.bas", `line ${l.no}: ${m}`));
  for (const v of vars) {
    libNames.add(v);
    if (v.replace("$", "").length > 2) report("gdslib.bas", `line ${l.no}: long name ${v}`);
    if (RESERVED_VARS.has(v)) report("gdslib.bas", `line ${l.no}: reserved name ${v}`);
  }
}

for (const file of targets) {
  const rows = parse(fs.readFileSync(file, "utf8"));
  const own = rows.filter((r) => r.no < 8000);
  const names = path.basename(file);
  let last = 0;
  for (const r of own) {
    if (r.no <= last) report(names, `line ${r.no} is out of order`);
    last = r.no;
    if (r.raw.length > 100) report(names, `line ${r.no} longer than 100 characters`);
    const { vars, issues } = scan(r.text);
    issues.forEach((m) => report(names, `line ${r.no}: ${m}`));
    for (const v of new Set(vars)) {
      const bare = v.replace(/[$%]$/, "");
      if (bare.length > 2) report(names, `line ${r.no}: long name ${v}`);
      if (RESERVED_VARS.has(v)) report(names, `line ${r.no}: reserved name ${v}`);
      if (libNames.has(v) && !INTERFACE.has(v)) report(names, `line ${r.no}: ${v} collides with a library variable`);
    }
  }
  if (!checkOnly) {
    fs.writeFileSync(file, `${[...own, ...lib].map((r) => r.raw).join("\n")}\n`);
    console.log(`synced ${names}: ${own.length} script lines + ${lib.length} library lines`);
  }
}

if (problems) {
  console.log(`${problems} problem(s)`);
  process.exitCode = 1;
} else {
  console.log("variable-name hygiene OK");
}
