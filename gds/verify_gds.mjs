// Parses, validates and renders the GDSII unit cells written by gds_*.bas.
// Usage: node gds\verify_gds.mjs [--svg] [file.gds ...]
// Checks stream structure, layer map, ground-plane coverage, net connectivity
// (plane, V0, M1, V1, M2) and the per-cell port expectations in SPEC.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const wantSvg = args.includes("--svg");
const inputs = args.filter((a) => !a.startsWith("--"));
const files = inputs.length
  ? inputs
  : fs.readdirSync(dir).filter((f) => /\.gds$/i.test(f)).map((f) => path.join(dir, f));

const PLANE = 1, V0 = 2, M1 = 3, V1 = 4, M2 = 5, RES = 7, TEXT = 10, NOTE = 11;
const ALLOWED = new Set([PLANE, V0, M1, V1, M2, RES, TEXT, NOTE]);
const METAL = new Set([PLANE, M1, M2]);
const VIA_LINKS = { [V0]: [PLANE, M1], [V1]: [M1, M2] };
const PP = 150; // ground-pad offset from the signal pad centre line, um

const pairs = (groups, a, b) => groups.map((g) => [`${g}-${a}`, `${g}-${b}`]);
const SPEC = {
  ZCOUPON: { joins: pairs(["Z1", "Z2", "Z3"], "P1", "P2"), opens: [] },
  RDLLOSS: { joins: pairs(["SH", "MD", "LG"], "P1", "P2"), opens: [] },
  STUBTEST: {
    joins: [...pairs(["A", "B", "C"], "P1", "P2"), ...pairs(["A", "B", "C"], "P1", "P3"),
      ...pairs(["A", "B", "C"], "P2", "P3")],
    opens: [],
  },
  TRLSET: {
    joins: pairs(["THRU", "L2", "L3", "L4", "L5"], "P1", "P2"),
    opens: pairs(["REF"], "P1", "P2"),
  },
  RFLEAK: { joins: pairs(["LK"], "P1", "P2"), opens: [] },
  VIAMATCH: { joins: pairs(["T"], "P1", "P2"), opens: [] },
  RDXTALK: {
    joins: [...pairs(["X1", "X2", "X3"], "P1", "P2"), ...pairs(["X1", "X2", "X3"], "P3", "P4")],
    opens: [...pairs(["X1", "X2", "X3"], "P1", "P3"), ...pairs(["X1", "X2", "X3"], "P1", "P4"),
      ...pairs(["X1", "X2", "X3"], "P2", "P3"), ...pairs(["X1", "X2", "X3"], "P2", "P4")],
  },
  RESONATOR2: { joins: [], opens: pairs(["R"], "P1", "P2"), ringPoints: 700 },
};
const LABELS = {
  ZCOUPON: 6, RDLLOSS: 6, STUBTEST: 9, TRLSET: 12, RFLEAK: 2, VIAMATCH: 4, RDXTALK: 12, RESONATOR2: 2,
};

function real8(b, o) {
  const sign = b[o] & 0x80 ? -1 : 1;
  const exp = (b[o] & 0x7f) - 64;
  let mant = 0;
  for (let i = 1; i < 8; i += 1) mant = mant * 256 + b[o + i];
  return sign * (mant / 2 ** 56) * 16 ** exp;
}

function parse(buf, errors) {
  const lib = { name: "", units: [0, 0], structs: [] };
  let o = 0;
  let cur = null;
  let el = null;
  const order = [];
  while (o < buf.length) {
    if (o + 4 > buf.length) { errors.push("truncated record header"); break; }
    const len = buf.readUInt16BE(o);
    const type = buf[o + 2];
    const dt = buf[o + 3];
    if (len < 4 || len % 2 || o + len > buf.length) { errors.push(`bad record length ${len} at ${o}`); break; }
    const d = buf.subarray(o + 4, o + len);
    o += len;
    order.push(type);
    const i16 = () => d.readInt16BE(0);
    const i32s = () => Array.from({ length: d.length / 4 }, (_, k) => d.readInt32BE(k * 4));
    switch (type) {
      case 0x00: if (dt !== 2 || i16() !== 600) errors.push("HEADER is not version 600"); break;
      case 0x01: lib.hasBgn = d.length === 24; break;
      case 0x02: lib.name = d.toString("latin1").replace(/\0+$/, ""); break;
      case 0x03: lib.units = [real8(d, 0), real8(d, 8)]; break;
      case 0x05: cur = { name: "", elements: [] }; lib.structs.push(cur); break;
      case 0x06: if (cur) cur.name = d.toString("latin1").replace(/\0+$/, ""); break;
      case 0x07: cur = null; break;
      case 0x08: el = { kind: "boundary", layer: 0, xy: [] }; break;
      case 0x09: el = { kind: "path", layer: 0, width: 0, xy: [] }; break;
      case 0x0c: el = { kind: "text", layer: 0, xy: [], text: "" }; break;
      case 0x0d: if (el) el.layer = i16(); break;
      case 0x0e: if (el) el.datatype = i16(); break;
      case 0x16: if (el) el.texttype = i16(); break;
      case 0x0f: if (el) el.width = i32s()[0]; break;
      case 0x21: break;
      case 0x10: if (el) {
        const v = i32s();
        for (let k = 0; k < v.length; k += 2) el.xy.push([v[k] / 1000, v[k + 1] / 1000]);
      } break;
      case 0x19: if (el) el.text = d.toString("latin1").replace(/\0+$/, ""); break;
      case 0x11:
        if (!cur || !el) errors.push("ENDEL outside an element");
        else { cur.elements.push(el); el = null; }
        break;
      case 0x04: break;
      default: break;
    }
  }
  const want = [0x00, 0x01, 0x02, 0x03, 0x05, 0x06];
  if (!want.every((t, k) => order[k] === t)) errors.push(`unexpected record order ${order.slice(0, 6)}`);
  if (order[order.length - 1] !== 0x04) errors.push("stream does not end with ENDLIB");
  if (order[order.length - 2] !== 0x07) errors.push("ENDSTR missing before ENDLIB");
  return lib;
}

function polysOf(el) {
  if (el.kind === "boundary") return [el.xy.slice(0, -1)];
  if (el.kind !== "path") return [];
  const hw = el.width / 2000;
  const out = [];
  for (let i = 0; i + 1 < el.xy.length; i += 1) {
    const [x1, y1] = el.xy[i];
    const [x2, y2] = el.xy[i + 1];
    const dx = x2 - x1, dy = y2 - y1;
    const n = Math.hypot(dx, dy) || 1;
    const nx = (-dy / n) * hw, ny = (dx / n) * hw;
    out.push([[x1 + nx, y1 + ny], [x2 + nx, y2 + ny], [x2 - nx, y2 - ny], [x1 - nx, y1 - ny]]);
  }
  return out;
}

function bbox(pts) {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const [x, y] of pts) { a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); }
  return [a, b, c, d];
}

function overlap(p, q) {
  for (const poly of [p, q]) {
    for (let i = 0; i < poly.length; i += 1) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % poly.length];
      const nx = y1 - y2, ny = x2 - x1;
      const proj = (s) => { let lo = Infinity, hi = -Infinity; for (const [x, y] of s) { const v = x * nx + y * ny; lo = Math.min(lo, v); hi = Math.max(hi, v); } return [lo, hi]; };
      const [a0, a1] = proj(p);
      const [b0, b1] = proj(q);
      const eps = 1e-6 * Math.hypot(nx, ny);
      if (a1 < b0 - eps || b1 < a0 - eps) return false;
    }
  }
  return true;
}

function inside(poly, x, y) {
  for (let i = 0; i < poly.length; i += 1) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    const c = (x2 - x1) * (y - y1) - (y2 - y1) * (x - x1);
    poly.s = poly.s ?? Math.sign((poly[1][0] - poly[0][0]) * (poly[2][1] - poly[0][1]) - (poly[1][1] - poly[0][1]) * (poly[2][0] - poly[0][0]));
    if (c * poly.s < -1e-6) return false;
  }
  return true;
}

function nets(struct) {
  const items = [];
  for (const el of struct.elements) {
    if (![PLANE, V0, M1, V1, M2].includes(el.layer)) continue;
    for (const poly of polysOf(el)) items.push({ el, layer: el.layer, poly, box: bbox(poly) });
  }
  items.sort((a, b) => a.box[0] - b.box[0]);
  const parent = items.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const linked = (a, b) => a === b || VIA_LINKS[a]?.includes(b) || VIA_LINKS[b]?.includes(a);
  for (let i = 0; i < items.length; i += 1) {
    const A = items[i];
    for (let j = i + 1; j < items.length && items[j].box[0] <= A.box[2] + 1e-6; j += 1) {
      const B = items[j];
      if (!linked(A.layer, B.layer)) continue;
      if (B.box[1] > A.box[3] + 1e-6 || B.box[3] < A.box[1] - 1e-6) continue;
      if (overlap(A.poly, B.poly)) parent[find(i)] = find(j);
    }
  }
  return { items, find };
}

function renderSvg(struct, file) {
  const all = struct.elements.filter((e) => e.xy.length).flatMap((e) => e.xy);
  const [gx0, gy0, gx1, gy1] = bbox(all);
  const fs2 = Math.max(gx1 - gx0, gy1 - gy0) / 70;
  // Labels are left-anchored like the GDSII default, so widen the view to hold them.
  const textEnd = Math.max(gx1, ...struct.elements.filter((e) => e.kind === "text").map((e) => e.xy[0][0] + e.text.length * fs2 * 0.65));
  const x0 = gx0, y0 = gy0, x1 = textEnd, y1 = gy1;
  const w = x1 - x0, h = y1 - y0;
  const px = 1800, scale = px / w;
  const fill = { [PLANE]: ["#b0bec5", 0.45], [M1]: ["#e08a1e", 0.9], [M2]: ["#c62828", 0.55], [V0]: ["#37474f", 1], [V1]: ["#1565c0", 1], [RES]: ["#2e7d32", 0.9] };
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${Math.round(h * scale)}" viewBox="${x0} ${-y1} ${w} ${h}">`,
    `<rect x="${x0}" y="${-y1}" width="${w}" height="${h}" fill="#ffffff"/>`];
  for (const layer of [PLANE, M1, V0, M2, V1, RES]) {
    const [color, op] = fill[layer];
    for (const el of struct.elements.filter((e) => e.layer === layer)) {
      if (el.kind === "path") {
        const pts = el.xy.map(([x, y]) => `${x},${-y}`).join(" ");
        out.push(`<polyline points="${pts}" fill="none" stroke="${color}" stroke-opacity="${op}" stroke-width="${el.width / 1000}" stroke-linejoin="round"/>`);
      } else {
        out.push(`<polygon points="${el.xy.map(([x, y]) => `${x},${-y}`).join(" ")}" fill="${color}" fill-opacity="${op}"/>`);
      }
    }
  }
  for (const el of struct.elements.filter((e) => e.kind === "text")) {
    out.push(`<text x="${el.xy[0][0]}" y="${-el.xy[0][1]}" font-family="Arial" font-size="${fs2}" text-anchor="start" dominant-baseline="middle" fill="#000">${el.text}</text>`);
  }
  out.push("</svg>");
  fs.writeFileSync(file, out.join("\n"));
  const png = file.replace(/\.svg$/, ".png");
  const r = spawnSync("magick", ["-background", "white", file, "-flatten", png], { encoding: "utf8" });
  return r.status === 0 ? png : null;
}

let failures = 0;
const fail = (cell, msg) => { failures += 1; console.log(`  FAIL ${cell}: ${msg}`); };

for (const file of files) {
  const errors = [];
  const buf = fs.readFileSync(file);
  const lib = parse(buf, errors);
  const base = path.basename(file).replace(/\.gds$/i, "").toUpperCase();
  console.log(`${base}: ${buf.length} bytes`);
  errors.forEach((m) => fail(base, m));
  if (lib.name !== "RFTEST") fail(base, `library name ${lib.name}`);
  if (Math.abs(lib.units[0] - 1e-3) > 1e-12 || Math.abs(lib.units[1] - 1e-9) > 1e-18) fail(base, `units ${lib.units}`);
  if (lib.structs.length !== 1 || lib.structs[0].name !== base) fail(base, `structures ${lib.structs.map((s) => s.name)}`);
  const s = lib.structs[0];
  if (!s) continue;

  const counts = {};
  for (const el of s.elements) {
    counts[el.layer] = (counts[el.layer] ?? 0) + 1;
    if (!ALLOWED.has(el.layer)) fail(base, `unexpected layer ${el.layer}`);
    if (el.kind === "boundary") {
      const f = el.xy[0], l = el.xy[el.xy.length - 1];
      if (el.xy.length < 5 || f[0] !== l[0] || f[1] !== l[1]) fail(base, `open boundary on layer ${el.layer}`);
    }
    for (const [x, y] of el.xy) if (Math.abs(x) > 2e6 || Math.abs(y) > 2e6) fail(base, "coordinate out of range");
  }
  console.log(`  elements by layer ${JSON.stringify(counts)}`);

  const planes = s.elements.filter((e) => e.layer === PLANE);
  if (planes.length !== 1) { fail(base, `${planes.length} ground-plane polygons`); continue; }
  const pb = bbox(planes[0].xy);
  const rest = s.elements.filter((e) => e.layer !== PLANE).flatMap((e) => e.xy);
  const gb = bbox(rest);
  const margin = Math.min(gb[0] - pb[0], gb[1] - pb[1], pb[2] - gb[2], pb[3] - gb[3]);
  console.log(`  geometry ${(gb[2] - gb[0]).toFixed(1)} x ${(gb[3] - gb[1]).toFixed(1)} um, plane margin ${margin.toFixed(1)} um`);
  if (margin < 100) fail(base, `plane margin ${margin}`);

  const { items, find } = nets(s);
  const planeNet = find(items.findIndex((i) => i.layer === PLANE));
  const netAt = (x, y) => {
    const hit = items.find((i) => (i.layer === M1 || i.layer === M2) && i.box[0] <= x && x <= i.box[2] && i.box[1] <= y && y <= i.box[3] && inside(i.poly, x, y));
    return hit ? find(items.indexOf(hit)) : null;
  };
  const labels = s.elements.filter((e) => e.kind === "text" && e.layer === TEXT);
  if (labels.length !== (LABELS[base] ?? labels.length)) fail(base, `${labels.length} labels, expected ${LABELS[base]}`);
  const net = new Map();
  for (const l of labels) {
    const [x, y] = l.xy[0];
    const n = netAt(x, y);
    if (n === null) { fail(base, `label ${l.text} is not on metal`); continue; }
    net.set(l.text, n);
    if (n === planeNet) fail(base, `signal pad ${l.text} shorts to the ground plane`);
    const gAcross = (dx, dy) => netAt(x + dx, y + dy) === planeNet && netAt(x - dx, y - dy) === planeNet;
    if (!gAcross(0, PP) && !gAcross(PP, 0)) fail(base, `pad ${l.text} lacks grounded pads on both sides`);
  }
  const spec = SPEC[base];
  const same = (a, b) => net.has(a) && net.has(b) && net.get(a) === net.get(b);
  if (spec) {
    for (const [a, b] of spec.joins) if (!same(a, b)) fail(base, `${a} and ${b} are not connected`);
    for (const [a, b] of spec.opens) if (!net.has(a) || !net.has(b) || same(a, b)) fail(base, `${a} and ${b} should be open`);
    const groups = new Map();
    for (const [t, n] of net) {
      const g = t.split("-")[0];
      for (const [t2, n2] of net) if (t2.split("-")[0] !== g && n === n2) fail(base, `${t} and ${t2} are connected across groups`);
      groups.set(g, true);
    }
    if (spec.ringPoints) {
      const ring = s.elements.find((e) => e.kind === "path" && e.layer === M1 && e.xy.length >= spec.ringPoints);
      if (!ring) fail(base, "ring path missing");
      else {
        const rn = find(items.findIndex((i) => i.el === ring));
        if ([...net.values()].includes(rn)) fail(base, "ring touches a feed");
        if (rn === planeNet) fail(base, "ring touches the ground plane");
      }
    }
    console.log(`  ${labels.length} port labels, ${spec.joins.length} joins, ${spec.opens.length} opens checked`);
  }
  if (wantSvg) {
    const outDir = path.join(dir, "previews");
    fs.mkdirSync(outDir, { recursive: true });
    const png = renderSvg(s, path.join(outDir, `${base}.svg`));
    console.log(`  rendered previews\\${base}.svg${png ? " and .png" : " (PNG conversion unavailable)"}`);
  }
}

console.log(failures ? `${failures} FAILURE(S)` : "ALL GDS CHECKS PASSED");
process.exitCode = failures ? 1 : 0;
