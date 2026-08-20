export type MenuItem = {
  name: string;
  aliases: string[];
  price: number;
};

/**
 * The business being automated. Swap this file (and the AI prompt guidance)
 * and the same engine runs a different business.
 */
export const business = {
  name: "Hostel Mess by Tiffin Butler",
  tagline: "WhatsApp orders, parsed by AI, approved by you",
  currency: "\u20B9",
  timezone: "Asia/Kolkata",
  menu: [
    { name: "Idli set", aliases: ["idli", "idli set", "idlis", "idly", "idli sambar"], price: 40 },
    { name: "Dosa", aliases: ["dosa", "dose", "plain dosa", "masala dosa"], price: 60 },
    { name: "Curd rice", aliases: ["curd rice", "thayir sadam", "curd"], price: 50 },
    { name: "Chapati set", aliases: ["chapati set", "chapati", "chapatis", "chappati", "chappati set", "chappatis", "roti set", "3 chappati"], price: 70 },
    { name: "Dal rice", aliases: ["dal rice", "rice dal", "dal + rice", "lemon rice"], price: 80 },
    { name: "Full meals", aliases: ["full meals", "meals", "thali", "south indian meals"], price: 100 },
    { name: "Veg fried rice", aliases: ["fried rice", "veg fried rice"], price: 90 },
  ] satisfies MenuItem[],

  aiPromptGuidance:
    "This is a tiffin/mess service in India. Recognize Indian food names and " +
    "hand-written-style spelling, Hindi-English code-switching, and typos. " +
    "Default quantity to 1 when not specified. Map items to canonical menu " +
    "names where obvious, otherwise keep the customer's name.",
};
