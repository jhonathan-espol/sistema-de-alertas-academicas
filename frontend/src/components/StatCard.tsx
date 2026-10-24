"use client";

import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: { value: string; positive: boolean };
  icon?: React.ReactNode;
  color?: string;
}

export default function StatCard({
  title,
  value,
  subtitle,
  trend,
  icon,
  color = "text-emerald-600",
}: StatCardProps) {
  return (
    <Card className="bg-white border border-gray-200">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-gray-500">{title}</CardTitle>
        {icon && <div className={`p-2 rounded-md bg-gray-50 ${color}`}>{icon}</div>}
      </CardHeader>
      <CardContent className="pt-0">
        <div className="text-2xl font-bold text-gray-900">{value}</div>
        {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
      </CardContent>
      {trend && (
        <CardFooter className="pt-2 border-t border-gray-100">
          <div className={`flex items-center gap-1 text-xs ${trend.positive ? "text-emerald-600" : "text-rose-600"}`}>
            {trend.positive ? "▲" : "▼"} {trend.value}
          </div>
        </CardFooter>
      )}
    </Card>
  );
}
