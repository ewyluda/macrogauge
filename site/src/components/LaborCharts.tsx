"use client";
import { useMemo } from "react";
import { EChart } from "./EChart";
import { C, baseOption } from "@/lib/chartTheme";

// baseOption() carries a tooltip.valueFormatter function — functions can't
// cross the server/client boundary as props, so this chart building must
// happen inside a client component, not the server page.
export function LaborMonthlyChart({
  months,
  payrollsYoy,
  unemploymentRate,
}: {
  months: string[];
  payrollsYoy: (number | null)[];
  unemploymentRate: (number | null)[];
}) {
  const option = useMemo(
    () => ({
      ...baseOption(),
      series: [
        { name: "Payrolls YoY %", type: "line", showSymbol: false, lineStyle: { width: 1.5 }, color: C.sky,
          data: months.map((mo, i) => [mo, payrollsYoy[i]] as [string, number | null]) },
        { name: "Unemployment %", type: "line", showSymbol: false, lineStyle: { width: 1.5 }, color: C.amber,
          data: months.map((mo, i) => [mo, unemploymentRate[i]] as [string, number | null]) },
      ],
    }),
    [months, payrollsYoy, unemploymentRate],
  );
  return <EChart height={300} option={option} />;
}

export function LaborClaimsChart({
  dates,
  initialClaims,
}: {
  dates: string[];
  initialClaims: (number | null)[];
}) {
  const option = useMemo(
    () => ({
      ...baseOption(),
      series: [
        { name: "Initial claims", type: "line", showSymbol: false, lineStyle: { width: 1.5 }, color: C.violet,
          data: dates.map((dt, i) => [dt, initialClaims[i]] as [string, number | null]) },
      ],
    }),
    [dates, initialClaims],
  );
  return <EChart height={240} option={option} />;
}
