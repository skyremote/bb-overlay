import { describe, expect, it } from "vitest";
import { detectRule, normaliseRule, tidyClause } from "../detector";

type Case = { text: string; expect: string | null; topic?: "writing" | "general" };

const positives: Case[] = [
  { text: "From now on never use hashtags in my LinkedIn posts", expect: "Never use hashtags in my LinkedIn posts.", topic: "writing" },
  { text: "No hashtags in my newsletter, ever. And never say synergy.", expect: "Newsletter: no hashtags. Never use the word synergy.", topic: "writing" },
  { text: "Never use the word synergy.", expect: "Never use the word synergy.", topic: "writing" },
  { text: "Always reply in plain English please", expect: "Always reply in plain English.", topic: "writing" },
  { text: "Don't ever deploy on a Friday without asking me first", expect: "Never deploy on a Friday without asking me first.", topic: "general" },
  { text: "do not ever rename files without telling me", expect: "Never rename files without telling me.", topic: "general" },
  { text: "I don't want you to ever invent a price for me", expect: "Never invent a price for me.", topic: "general" },
  { text: "Make sure you always run the tests before you commit", expect: "Always run the tests before you commit.", topic: "general" },
  { text: "Stop using exclamation marks in client emails.", expect: "Stop using exclamation marks in client emails.", topic: "writing" },
  { text: "Keep it short. From now on, always put the price in the first line of a quote.", expect: "Always put the price in the first line of a quote.", topic: "general" },
  { text: "Going forward, never cc the finance team on supplier invoices", expect: "Never cc the finance team on supplier invoices.", topic: "general" },
  { text: "No emojis in my community posts", expect: "Community posts: no emojis.", topic: "writing" },
  { text: "Every time you write an email for me, use the house style guide first", expect: "Every time you write an email for me, use the house style guide first.", topic: "writing" },
  { text: "never ever use the word utilise", expect: "Never use the word utilise.", topic: "writing" },
  { text: "Okay so always start client emails with Hi and their first name", expect: "Always start client emails with Hi and their first name.", topic: "writing" },
  {
    // Voice-dictated dump: long, chained with "and", rule buried in the middle.
    text: "So I've been looking at the proposal email and honestly it reads a bit stiff and I want it to sound like me and from now on never apologise for the price in a client email and then we can send it this afternoon once the design has been checked",
    expect: "Never apologise for the price in a client email.",
    topic: "writing",
  },
  {
    text: "Right so the deck is nearly there and the images are good and the only thing is the jargon, and look, never use the word slice in client decks, and then send it over to me tonight",
    expect: "Never use the word slice in client decks.",
    topic: "writing",
  },
];

const negatives: Case[] = [
  { text: "Can you never use hashtags in this one?", expect: null },
  { text: "Why do you always use hashtags?", expect: null },
  { text: "I've never used Supabase before, is it any good?", expect: null },
  { text: "Never mind, I sorted it myself.", expect: null },
  { text: "As always, thanks for the help.", expect: null },
  { text: "He always replies late on Fridays.", expect: null },
  { text: "Build me a landing page for my bakery with a pricing section.", expect: null },
  { text: "```\n// never use var\nconst x = 1;\n```\nWhat does this code do?", expect: null },
  { text: "> Never use hashtags\nThat was in the old profile, is it still there?", expect: null },
  { text: "It never rains in Seville in October, apparently.", expect: null },
  {
    // Long voice dump with no rule in it.
    text: "So I was on the call with the client and he said the deal might close next quarter and I think we should look at the invoices and see what's outstanding and then maybe we can put together a plan for the spring workshop and send it over to the team when it's ready",
    expect: null,
  },
  { text: "Is it always this slow to build?", expect: null },
  { text: "Run the tests and push the branch.", expect: null },
];

describe("detectRule positives", () => {
  for (const c of positives) {
    it(c.text.slice(0, 60), () => {
      const got = detectRule(c.text);
      expect(got?.rule ?? null).toBe(c.expect);
      if (c.topic) expect(got?.topic).toBe(c.topic);
    });
  }
});

describe("detectRule negatives", () => {
  for (const c of negatives) {
    it(c.text.slice(0, 60), () => {
      expect(detectRule(c.text)).toBeNull();
    });
  }
});

describe("tidy and normalise", () => {
  it("normalises punctuation and case", () => {
    expect(normaliseRule("Never use hashtags.")).toBe(normaliseRule("never use HASHTAGS"));
  });
  it("turns scoped no-X into a heading", () => {
    expect(tidyClause("no hashtags in my newsletter, ever")).toBe("Newsletter: no hashtags.");
  });
  it("ignores empty and non-string input", () => {
    expect(detectRule("")).toBeNull();
    expect(detectRule(undefined as unknown as string)).toBeNull();
  });
});
