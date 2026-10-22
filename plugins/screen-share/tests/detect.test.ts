import { describe, expect, it } from "vitest";
import { detect, type DetectOptions } from "../detect";
import { parseSlash } from "../server";

// Fictional people and companies for the tests.
const KNOWN = ["Ines Li Okafor", "Rowan Hale", "Bram", "Tove Lund"];
const COMPANIES = ["Northwind", "Contoso Ltd"];
const opts: DetectOptions = { knownNames: KNOWN, companies: COMPANIES, maskCompanies: false, aggressiveNames: true };
const hidden = (text: string, o: DetectOptions = opts) => detect(text, o).map((m) => text.slice(m.start, m.end));
const kinds = (text: string, o: DetectOptions = opts) => detect(text, o).map((m) => m.kind);

describe("emails", () => {
  it("hides addresses", () => {
    expect(hidden("write to owen@northvale.co today")).toEqual(["owen@northvale.co"]);
    expect(hidden("jonas.weber@contoso.com")).toEqual(["jonas.weber@contoso.com"]);
  });
  it("ignores handles and paths", () => {
    expect(hidden("ping @thread:thr_abc and ~/a/b.md")).toEqual([]);
  });
});

describe("phones", () => {
  it.each(["+44 7700 900123", "+1 415 555 0132", "+49 30 5550 1923", "07700 900123", "(415) 555-0132", "+44 (0)20 7946 0958", "0151 1234567"])(
    "hides %s",
    (p) => {
      expect(hidden(`call ${p} now`)).toEqual([p]);
      expect(kinds(`call ${p} now`)).toEqual(["phone"]);
    },
  );
  it.each(["2026-10-22", "14:06", "version 0.6.49", "143k tokens", "HRA 1234", "ran 12 tests in 3.2s", "id 1792565525444"])("leaves %s", (t) => {
    expect(kinds(t)).not.toContain("phone");
  });
});

describe("amounts", () => {
  it.each(["$48,000", "£1.2m", "€700", "$1.6", "USD 5k", "700 EUR", "$22,750.50", "€ 900", "48.000 €", "£250k"])("hides %s", (a) => {
    expect(hidden(`deal ${a} closed`)).toEqual([a]);
  });
  it.each(["40x cheaper", "5% discount", "Opus 5.5", "2.7x slower", "100 mods"])("leaves %s", (t) => {
    expect(kinds(t)).not.toContain("amount");
  });
});

describe("bank and tax numbers", () => {
  it("hides IBANs", () => {
    expect(hidden("IBAN DE89 3704 0044 0532 0130 00 please")).toEqual(["DE89 3704 0044 0532 0130 00"]);
    expect(hidden("GB29NWBK60161331926819")).toEqual(["GB29NWBK60161331926819"]);
  });
  it("hides VAT and Steuernummer", () => {
    expect(hidden("USt-IdNr DE123456789")).toEqual(["DE123456789"]);
    expect(hidden("Steuernummer 123/456/78901")).toEqual(["123/456/78901"]);
  });
  it("leaves dates", () => {
    expect(kinds("on 22/10/2026")).toEqual([]);
  });
});

describe("names", () => {
  it("hides first-last pairs in a leads table", () => {
    for (const n of ["Owen Whitford", "Priya Shah", "Tom Ellis", "Maya Lopez", "Sam Carter", "Lena Fischer"]) {
      expect(hidden(`${n} asked for a call`)).toEqual([n]);
    }
  });
  it("strips a leading verb", () => {
    expect(hidden("Call Maya Lopez on Thursday")).toEqual(["Maya Lopez"]);
  });
  it("hides known people, including single first names", () => {
    expect(hidden("Ines Li Okafor signed")).toEqual(["Ines Li Okafor"]);
    expect(hidden("ask Bram about it")).toEqual(["Bram"]);
    expect(hidden("Rowan Hale and Tove Lund")).toEqual(["Rowan Hale", "Tove Lund"]);
  });
  it("hides an unambiguous first name on its own", () => {
    expect(hidden("remind Priya before Friday")).toEqual(["Priya"]);
  });
  it("does not treat ordinary words as names", () => {
    expect(hidden("We will keep it short. May is busy.")).toEqual([]);
  });
  it("hides an unknown capitalised pair in aggressive mode, not otherwise", () => {
    expect(hidden("met Zbigniew Kowalczyk")).toEqual(["Zbigniew Kowalczyk"]);
    expect(hidden("met Zbigniew Kowalczyk", { ...opts, aggressiveNames: false })).toEqual([]);
  });
  it("leaves product and interface phrases", () => {
    expect(hidden("Open Claude Code and the Helper Desk panel")).toEqual([]);
    expect(hidden("Screen Share is on")).toEqual([]);
  });
});

describe("companies", () => {
  it("stay readable by default and are never taken for people", () => {
    expect(hidden("Northwind renewed")).toEqual([]);
    expect(hidden("Contoso Ltd invoice")).toEqual([]);
  });
  it("are hidden when the setting is on", () => {
    expect(hidden("Northwind renewed", { ...opts, maskCompanies: true })).toEqual(["Northwind"]);
  });
});

describe("/screenshare", () => {
  it("parses the slash command", () => {
    expect(parseSlash("/screenshare")).toBe("toggle");
    expect(parseSlash(" /screen-share on ")).toBe("on");
    expect(parseSlash("/Screen share OFF")).toBe("off");
    expect(parseSlash("/screenshare please")).toBeNull();
    expect(parseSlash("turn on /screenshare")).toBeNull();
  });
});
