import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const out = new URL("./dist/", import.meta.url); await mkdir(out, { recursive: true });
await build({ absWorkingDir: root, entryPoints: ["fixtures/fixture.tsx"], outfile: fileURLToPath(new URL("fixture.js", out)), bundle: true, format: "iife", jsx: "automatic", minify: false, sourcemap: true });
await writeFile(new URL("index.html", out), '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BB Overlay guide — isolated host fixture</title><link rel="stylesheet" href="./fixture.css"></head><body><div id="fixture"></div><script src="./fixture.js"></script></body></html>');
console.log(`Isolated static fixture: ${fileURLToPath(new URL("index.html", out))}`);
