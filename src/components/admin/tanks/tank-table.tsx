"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusIcon } from "@/components/ui/status-icon";
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatLiters } from "@/lib/format";

export interface TankRow {
  id: string;
  name: string;
  site: { id: string; name: string };
  fuelType: "PETROL" | "DIESEL";
  capacityLiters: number;
  currentStockLiters: number;
  lowStockThreshold: number;
  isLow: boolean;
  isActive: boolean;
  operators: Array<{ id: string; displayName: string }>;
}

export interface TankTableProps {
  tanks: TankRow[];
  isLoading: boolean;
  canEdit: boolean;
  onEdit: (tank: TankRow) => void;
}

export function TankTable({ tanks, isLoading, canEdit, onEdit }: TankTableProps) {
  const columnCount = canEdit ? 8 : 7;
  return (
    <TableContainer>
      <Table>
        <TableHeader>
          <tr>
            <TableHead>Tank</TableHead>
            <TableHead>Site</TableHead>
            <TableHead>Fuel</TableHead>
            <TableHead>Current stock</TableHead>
            <TableHead>Capacity</TableHead>
            <TableHead>Operators</TableHead>
            <TableHead>Status</TableHead>
            {canEdit ? <TableHead /> : null}
          </tr>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={columnCount} className="py-8 text-center text-muted">
                Loading tanks…
              </TableCell>
            </TableRow>
          ) : tanks.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columnCount} className="py-8 text-center text-muted">
                No tanks in your scope.
              </TableCell>
            </TableRow>
          ) : (
            tanks.map((tank) => (
              <TableRow key={tank.id}>
                <TableCell className="font-semibold">{tank.name}</TableCell>
                <TableCell>{tank.site.name}</TableCell>
                <TableCell>
                  <Badge variant={tank.fuelType === "PETROL" ? "petrol" : "diesel"}>
                    {tank.fuelType === "PETROL" ? "Petrol" : "Diesel"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <span className="inline-flex items-center gap-1.5 font-semibold">
                    {tank.isLow ? <StatusIcon kind="warning" label="Below threshold" /> : null}
                    {formatLiters(tank.currentStockLiters)}
                  </span>
                </TableCell>
                <TableCell className="text-muted">{formatLiters(tank.capacityLiters)}</TableCell>
                <TableCell className="text-muted">
                  {tank.operators.length > 0
                    ? tank.operators.map((operator) => operator.displayName).join(", ")
                    : "—"}
                </TableCell>
                <TableCell>
                  {tank.isActive ? (
                    <Badge variant="success">Active</Badge>
                  ) : (
                    <Badge variant="outline">Inactive</Badge>
                  )}
                </TableCell>
                {canEdit ? (
                  <TableCell>
                    <Button variant="ghost" size="sm" onClick={() => onEdit(tank)}>
                      Edit
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
