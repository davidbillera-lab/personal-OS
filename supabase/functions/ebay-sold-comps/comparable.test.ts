import { assertEquals } from "jsr:@std/assert@1";
import { comparable } from "./comparable.ts";

// Real sales behind the 2026-11-16 Arcade1Up alert, converted from DKK to USD.
Deno.test("drops the new-in-box sale and the AC adapter", () => {
  const rows = [
    { title: "Arcade1Up Street Fighter II Champion Edition Arcade Cabinet W/Riser NEW IN BOX", price: 688, condition: "Brand New" },
    { title: "Arcade1Up Street Fighter II Turbo Champion Edition Arcade Cabinet", price: 318, condition: "Pre-Owned" },
    { title: "12V AC Adapter 4 Arcade1Up STF-A-303911 Street Fighter II CE", price: 31, condition: "Brand New" },
    { title: "Arcade1Up Street Fighter II Champion Edition Turbo Hyper Fighting Arcade Cabinet", price: 212, condition: "Pre-Owned" },
    { title: "Street Fighter II Champion Edition Arcade1Up Cabinet", price: 212, condition: "Pre-Owned" },
    { title: "Arcade1Up Street Fighter 2 cabinet riser", price: 250, condition: "Pre-Owned" },
  ];
  assertEquals(comparable(rows).map((r) => r.price), [318, 212, 212, 250]);
});

Deno.test("drops broken units and keeps working ones", () => {
  const rows = [
    { title: "Sega Dreamcast Console White HKT-3020", price: 127 },
    { title: "Broken Sega Dreamcast Console Only HKT-3020 Bad Game Reader", price: 53 },
    { title: "Sega Dreamcast White HKT-3020", price: 148 },
    { title: "SEGA Dreamcast HKT-3020 Tested Works w Cords Controller VMU", price: 175 },
  ];
  assertEquals(comparable(rows).map((r) => r.price), [127, 148, 175]);
});

Deno.test("keeps new sales when there are too few used ones", () => {
  const rows = [
    { title: "DeWalt DCF887 impact driver new in box", price: 120, condition: "New" },
    { title: "DeWalt DCF887 impact driver", price: 80, condition: "Pre-Owned" },
  ];
  assertEquals(comparable(rows).length, 2);
});
