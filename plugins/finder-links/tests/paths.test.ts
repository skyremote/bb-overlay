import { describe, expect, it } from "vitest";
import { candidatePaths, classify, isBundle, joinPath, mirrorsOf, parseMirrors } from "../lib/paths";

const HOME = "/Users/me";
const mirrors = parseMirrors("~/Local = ~/Share", HOME);

describe("classify", () => {
  it("accepts absolute, home and relative paths", () => {
    expect(classify("/Users/me/Share/Clients/")?.kind).toBe("absolute");
    expect(classify("~/Documents/GitHub/bluplai")?.kind).toBe("home");
    expect(classify("Source/Siva_ERR_AI_Workshop_Opportunities_2026-10-19.pptx")?.kind).toBe("relative");
    expect(classify("Email_to_Siva_ERR_Proposal_v3.md")?.kind).toBe("relative");
    expect(classify("00_Invoices & Receipts (Tax Lady)/2026")?.kind).toBe("relative");
  });
  it("rejects commands, bare extensions, URLs and globs", () => {
    for (const t of [".docx", ".html", "bb plugin list", "npm ci --include=dev", "https://example.com/a.md", "*.md", "$HOME/x", "/", "//net/share", "v3"]) {
      expect(classify(t), t).toBeNull();
    }
  });
});

describe("resolution", () => {
  it("tries earlier folders newest first, then the workspace, each with its mirror", () => {
    const got = candidatePaths("Source/deck.pptx", ["/a/", "/Users/me/Local/x"], "/Users/me/Local", mirrors, HOME);
    expect(got).toEqual([
      "/Users/me/Local/x/Source/deck.pptx",
      "/Users/me/Share/x/Source/deck.pptx",
      "/a/Source/deck.pptx",
      "/Users/me/Local/Source/deck.pptx",
      "/Users/me/Share/Source/deck.pptx",
    ]);
  });
  it("expands ~ and maps mirrors both ways", () => {
    expect(candidatePaths("~/Share/a.md", [], null, mirrors, HOME)).toEqual(["/Users/me/Share/a.md", "/Users/me/Local/a.md"]);
    expect(mirrorsOf("/Users/me/Localx/a", mirrors)).toEqual([]);
  });
  it("does not climb above root and spots bundles", () => {
    expect(joinPath("/a/b", "../../../etc")).toBe("/etc");
    expect(isBundle("/Applications/bb.app")).toBe(true);
    expect(isBundle("/Users/me/Share")).toBe(false);
  });
});
