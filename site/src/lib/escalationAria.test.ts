import { describe, expect, it } from "vitest";
import { escalationAriaLabel } from "./escalationAria";

describe("escalationAriaLabel (audit F10)", () => {
  const base = { baseMonth: "2024-08", endMonth: "2026-08", measuredEnd: 11_545_291 };
  it("states the realized range as its endpoints, never the band's thickness", () => {
    const s = escalationAriaLabel({ ...base, forward: {
      deliveryMonth: "2028-08", label: "Trailing 3yr", carried: 12_925_764,
      band: { p10: 10_323_446, p90: 12_406_534, p80: 11_465_238 } } });
    expect(s).toBe("Escalated cost from 2024-08 to 2028-08. Measured on the DC Build index to 2026-08: $11,545,291. " +
      "Carried at Trailing 3yr to 2028-08: $12,925,764. Realized range (p10–p90) at 2028-08: $10,323,446 to $12,406,534; " +
      "P80 allowance $11,465,238.");
    expect(s).not.toContain("2,083,088");          // p90 − p10, the stacked series' raw value
  });
  it("covers a short horizon with no band and a measured-only view", () => {
    expect(escalationAriaLabel({ ...base, forward: { deliveryMonth: "2026-12", label: "Trailing 3yr", carried: 11_800_000, band: null } }))
      .toBe("Escalated cost from 2024-08 to 2026-12. Measured on the DC Build index to 2026-08: $11,545,291. " +
        "Carried at Trailing 3yr to 2026-12: $11,800,000.");
    expect(escalationAriaLabel({ ...base, forward: null }))
      .toBe("Escalated cost from 2024-08 to 2026-08. Measured on the DC Build index to 2026-08: $11,545,291.");
  });
});
