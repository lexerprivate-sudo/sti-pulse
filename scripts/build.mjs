#!/usr/bin/env node
/**
 * Build step: inlines style.css and app.js into index.template.html,
 * producing public/index.html (single-file PWA — no external requests,
 * so broken networks never strip styles/scripts).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pub = path.join(root, "public");
const template = fs.readFileSync(path.join(pub, "index.template.html"), "utf8");
const css = fs.readFileSync(path.join(pub, "style.css"), "utf8");
const js = fs.readFileSync(path.join(pub, "app.js"), "utf8");

const out = template.replace("{{CSS}}", () => css.trim()).replace("{{JS}}", () => js.trim());
fs.writeFileSync(path.join(pub, "index.html"), out, "utf8");
console.log(`built public/index.html (${out.length} bytes)`);
