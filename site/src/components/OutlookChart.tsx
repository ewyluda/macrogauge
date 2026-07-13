"use client";

import { useMemo } from "react";
import { EChart } from "./EChart";
import { C, baseOption } from "@/lib/chartTheme";
import { fmtMonth } from "@/lib/format";
import type { Outlook } from "@/lib/types";

type Point = [string, number];

const date = (month: string) => `${month}-01`;

export function OutlookChart({ outlook }: { outlook: Outlook }) {
  const terminal = outlook.forecast[outlook.forecast.length - 1];
  const baselineName = `Base effects only (flat ${outlook.parameters.baseline_annual_pct}% ann.)`;
  const option = useMemo(() => {
    const origin: Point = [date(outlook.origin_month), outlook.latest_complete_month_yoy_pct];
    const lows: Point[] = [origin, ...outlook.forecast.map((row) => [date(row.month), row.low_yoy_pct] as Point)];
    const ranges: Point[] = [[origin[0], 0], ...outlook.forecast.map((row) => [
      date(row.month),
      +(row.high_yoy_pct - row.low_yoy_pct).toFixed(2),
    ] as Point)];

    return {
      ...baseOption(),
      grid: { left: 48, right: 16, top: 40, bottom: 28 },
      legend: {
        top: 0,
        data: ["Macrogauge (actual)", "Outlook (central)", baselineName],
        textStyle: { color: C.muted, fontSize: 11 },
        icon: "circle",
        itemWidth: 8,
        itemHeight: 8,
      },
      yAxis: {
        type: "value",
        scale: true,
        axisLabel: { color: C.muted, formatter: "{value}%" },
        splitLine: { lineStyle: { color: C.border } },
      },
      series: [
        {
          name: "band-low",
          type: "line",
          stack: "outlook-band",
          // default 'samesign' restacks negatives separately: the band tears
          // apart the month a low crosses 0
          stackStrategy: "all",
          data: lows,
          showSymbol: false,
          lineStyle: { opacity: 0 },
          itemStyle: { opacity: 0 },
          tooltip: { show: false },
        },
        {
          name: "realized-volatility band",
          type: "line",
          stack: "outlook-band",
          stackStrategy: "all",
          data: ranges,
          showSymbol: false,
          lineStyle: { opacity: 0 },
          itemStyle: { opacity: 0 },
          areaStyle: { color: "rgba(52, 211, 153, 0.18)" },
          tooltip: { show: false },
        },
        {
          name: "Macrogauge (actual)",
          type: "line",
          data: outlook.history.map((row) => [date(row.month), row.yoy_pct]),
          showSymbol: false,
          lineStyle: { width: 2, color: C.sky },
          itemStyle: { color: C.sky },
        },
        {
          name: "Outlook (central)",
          type: "line",
          data: [origin, ...outlook.forecast.map((row) => [date(row.month), row.central_yoy_pct] as Point)],
          showSymbol: false,
          lineStyle: { width: 2, type: "dashed", color: C.emerald },
          itemStyle: { color: C.emerald },
        },
        {
          name: baselineName,
          type: "line",
          data: [origin, ...outlook.base_effects_only.map((row) => [date(row.month), row.yoy_pct] as Point)],
          showSymbol: false,
          lineStyle: { width: 1.5, type: "dotted", color: C.violet },
          itemStyle: { color: C.violet },
        },
      ],
    };
  }, [outlook, baselineName]);

  return (
    <div className="outlook-module">
      <div className="outlook-meta">
        <span>model {outlook.model}</span>
        <span>as of {outlook.as_of}</span>
        <span>{outlook.driver_coverage_pct.toFixed(0)}% forward-driver coverage</span>
      </div>
      <div className="outlook-summary">
        <span>
          latest complete month <strong className="outlook-actual">{outlook.latest_complete_month_yoy_pct.toFixed(2)}%</strong>
        </span>
        <span aria-hidden="true">→</span>
        <span>
          {fmtMonth(date(terminal.month))} <strong className="outlook-central">{terminal.central_yoy_pct.toFixed(2)}%</strong>{" "}
          <small>({terminal.low_yoy_pct.toFixed(2)}–{terminal.high_yoy_pct.toFixed(2)}%)</small>
        </span>
        <span className="outlook-band-copy">
          band = {outlook.sigma_monthly_pp.toFixed(3)}pp/mo × √horizon
        </span>
      </div>
      <EChart option={option} height={320} />
      <div className="outlook-drivers">
        {outlook.drivers.map((driver) => (
          <div
            key={driver.key}
            className={`outlook-driver outlook-driver-${driver.status}`}
            title={`${driver.effect}${driver.sources.length ? ` · ${driver.sources.join(" + ")}` : ""}`}
          >
            <span>{driver.name}</span>
            <strong>{driver.reading}</strong>
            <small>{driver.status}{driver.as_of ? ` · ${driver.as_of}` : ""}</small>
          </div>
        ))}
      </div>
      <p className="outlook-method">{outlook.method}</p>
      <p className="outlook-disclaimer">{outlook.disclaimer}</p>
    </div>
  );
}
