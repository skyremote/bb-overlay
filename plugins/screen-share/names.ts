// Common first names across English, German, Spanish, Italian, French, Polish,
// Dutch, Nordic, Indian, Chinese and Arabic usage. Used to recognise
// "First Last" people names; over-masking is preferred to under-masking.
const RAW_FIRST_NAMES = `
Aaron Abby Abdul Abigail Adam Adrian Ahmed Aidan Aisha Alan Albert Alberto Alejandro Aleksander Alex Alexa Alexander Alexandra Alexis Alfie Ali Alice Alicia Alison Amanda Amber Amelia Amir Amit Amy Ana Anders Andrea Andreas Andrei Andrew Andy Angela Anika Anil Anita Ann Anna Anne Annika Anthony Anton Antonio Anya Archie Arjun Arthur Ashley Astrid Aurora Ava Barbara Beatriz Becky Ben Benjamin Bernd Beth Bethany Bianca Bill Bob Bogdan Brandon Brian Bruno Bryan Caitlin Callum Cameron Camila Carl Carla Carlos Carmen Caroline Carolyn Catherine Charles Charlie Charlotte Chen Chloe Chris Christian Christina Christine Christopher Claire Clara Claudia Colin Connor Craig Cristina Dale Damian Dan Daniel Daniela Danny Darren Dave David Dean Deborah Declan Dennis Diana Diego Dieter Dominic Donald Dorota Douglas Duncan Dylan Edward Elena Eli Elias Elijah Elisa Elizabeth Ella Ellie Emily Emma Eric Erik Erin Ethan Eva Evelyn Fabian Fatima Felix Fernando Filip Finn Fiona Florian Francesca Francesco Frank Franz Freddie Frederik Freya Gabriel Gabriela Gareth Gary Gemma George Georgia Gerhard Giorgio Giulia Giuseppe Gordon Graham Greg Gregory Gustav Hamza Hannah Hans Harry Harvey Hassan Heather Heidi Helen Helena Henrik Henry Holly Hugo Ian Igor Ingrid Isaac Isabel Isabella Isla Ivan Jack Jacob Jacqueline Jake Jakub James Jamie Jan Jana Jane Janet Jason Javier Jay Jean Jeff Jennifer Jenny Jens Jeremy Jessica Jill Joan Joanna Joe Joel Johan Johann Johanna John Jonas Jonathan Jordi Jorge Jose Joseph Josh Joshua Juan Judith Julia Julian Julie Julien Justin Kai Kamil Karen Karl Karolina Kasia Kate Katharina Katherine Kathryn Katie Katrin Kayla Keith Kelly Ken Kevin Kim Klaus Krzysztof Kumar Kyle Lars Laura Lauren Leah Lee Leandro Lena Leo Leon Leonie Liam Lily Linda Lisa Logan Lorenzo Louis Louise Luca Lucas Lucy Luis Luke Lukas Maciej Magdalena Malik Manuel Marc Marcel Marco Marcus Margaret Maria Marie Marina Mario Marisa Marta Martin Mary Mason Mateo Matt Matteo Matthew Matthias Max Maya Megan Mehmet Melanie Melissa Mia Michael Michal Michelle Miguel Mike Mila Milan Mohamed Mohammed Monika Morgan Muhammad Nadia Naomi Natalia Natalie Nathan Neil Nicholas Nick Nicola Nicolas Niklas Nikolai Nina Noah Noel Nora Oleg Olga Oliver Olivia Omar Oscar Owen Pablo Paolo Patricia Patrick Paul Paula Pavel Pedro Peter Petra Philip Philipp Pierre Piotr Priya Rachel Rafael Raj Rajesh Ralf Ravi Rebecca Ricardo Richard Rick Robert Roberto Robin Rohan Roman Ronald Rosa Rose Ruby Russell Ryan Sabine Sahil Sally Sam Samantha Samuel Sandra Sara Sarah Sascha Scott Sean Sebastian Sergei Sergio Shane Sharon Siddharth Simon Simone Siva Sofia Sophia Sophie Stefan Stefanie Stephanie Stephen Steve Steven Stuart Susan Suzanne Sven Szymon Tanya Teresa Theo Thomas Tim Timothy Tobias Tom Tomasz Tony Tracy Ursula Valentina Vanessa Victor Victoria Vikram Vincent Wei Wes Wesley Will William Wojciech Xavier Yan Yasmin Yusuf Zach Zachary Zara Zoe Zofia
`;
export const FIRST_NAMES: ReadonlySet<string> = new Set(RAW_FIRST_NAMES.split(/\s+/).filter(Boolean));

/** First names that are also ordinary words; hidden only as part of "First Last". */
export const AMBIGUOUS_FIRST_NAMES: ReadonlySet<string> = new Set(
  "Will Max Mark Rose Ruby Lily Jack Grace Hope Joy Faith Bill Rick Dale Dean Lee Kim Jan Ken Sam Mia Eva Ella Ava Leo Kai Jay Noel Ian Bob Andy Chris Dan Nick Tom Mike Steve Tim Tony Zach Matt Josh Ben Alan Paul Robin Morgan Logan Mason Jordan Pierre Milan Georgia Florian Victoria Sofia Vincent Holly Ana Max Owen Finn Isla Nora Petra Julie Rosa Simone Victor Theo Henry Hugo Felix Oscar Arthur Archie Louis Lucas Luca Noah Marc Marco Mario Diego Pablo Pedro Omar Ali Amir Raj Ravi Chen Wei Yan Kumar".split(
    " ",
  ),
);

/**
 * Capitalised words that are product, interface or common sentence words,
 * never on their own the start of a person's name.
 */
export const NAME_STOPWORDS: ReadonlySet<string> = new Set(
  `The A An And Or But If Then When Where What Why How Who This That These Those Here There It Its I We You He She They My Our Your Their
Hi Hello Hey Dear Thanks Thank Best Regards Kind Cheers Yes No Not Done Ok Okay Please Note Also Next Now New Old Today Tomorrow Yesterday
Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June July August September October November December
Call Email Mail Ask Tell Send Reply Draft Read Write Edit Open Close Start Stop Run Build Fix Add Remove Check Show Hide Turn Keep Save Use Make Get Set Let Go
Claude Code Opus Sonnet Haiku Fable Codex Cursor Gemini Grok Sol GPT ChatGPT OpenAI Anthropic Google Microsoft Apple Amazon Meta Vercel Supabase Clerk Github GitHub Git
NavAIgate Navaigate One Two Three Skool Descript Remotion Tailwind React Astro Node Python TypeScript JavaScript Docker
Agent Agents Flow Helper Desk Screen Share Cache Clock Reflect Handoff Thread Threads Chat Side Panel Panels Project Projects Settings Plugin Plugins Mode Modes
Task Tasks Todo To-do Running Finished Total Time Tokens Cost Subagent Subagents Session Sessions Workspace Environment Machine Terminal Browser Inbox Notes Talk
Control Room Needs Unread Parked Pinned Come Back Later Good Morning Afternoon Evening Night Daily Brief Weekly Monthly Quarterly Annual Report Plan Review
Kanban Board Backlog Progress Status Update Updates Release Version Pro Max Plus Free Premium Studio Live Online Local Remote Home Away
North South East West Street Road Lane Avenue Park House Hall Centre Center Building Office Group Ltd Limited GmbH KG Inc LLC Corp Company Team Partners
University College School Institute Bank Fund Capital Ventures Labs Lab Systems Solutions Services Technologies Digital Media Studios Games Software
AI API UI UX CLI SDK MCP LLM CRM QBR EBR CEO CTO CFO COO VP PM PDF PPTX HTML CSS JSON URL USD EUR GBP UK US EU DE`.split(/\s+/),
);
