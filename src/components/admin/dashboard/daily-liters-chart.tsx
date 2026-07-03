"use client";

import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import type { DailyLitersPoint } from "@/server/services/dashboard.service";
import { formatLiters } from "@/lib/format";

/**
 * D1 "Daily liters issued" — trailing 7 Colombo days. Matches the prototype's
 * teal bar block; the most recent day is emphasised at full primary opacity.
 */
export function DailyLitersChart({ data }: { data: DailyLitersPoint[] }) {
  const hasVolume = data.some((point) => point.liters > 0);

  return (
    <div className="rounded-[28px] border border-border bg-card p-6">
      <div className="flex items-center justify-between">
        <p className="font-bold">Daily liters issued</p>
        <span className="text-sm text-muted">Last 7 days</span>
      </div>

      <div className="mt-6 h-56 rounded-2xl border border-border bg-slate-50 p-4">
        {hasVolume ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tick={{ fill: "#475569", fontSize: 12 }}
              />
              <Tooltip
                cursor={{ fill: "rgba(15,118,110,0.06)" }}
                contentStyle={{
                  borderRadius: 16,
                  border: "1px solid #E2E8F0",
                  boxShadow: "0 10px 30px rgba(15,23,42,.08)",
                  fontSize: 12,
                }}
                labelStyle={{ color: "#0F172A", fontWeight: 600 }}
                formatter={(value: number) => [formatLiters(value), "Issued"]}
              />
              <Bar dataKey="liters" radius={[8, 8, 0, 0]} maxBarSize={48}>
                {data.map((point, index) => (
                  <Cell
                    key={point.date}
                    fill="#0F766E"
                    fillOpacity={index === data.length - 1 ? 1 : 0.35 + (index / data.length) * 0.4}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted">
            No fuel issued in the last 7 days.
          </div>
        )}
      </div>
    </div>
  );
}
