"use client";

import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
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
import { FUEL_CONFIG, fuelLabel, type FuelTypeName } from "@/lib/fuel";
import { formatMeter, type MeterTypeName } from "@/lib/meter";

export interface VehicleRow {
  id: string;
  plateNumber: string;
  vehicleType: { id: string; name: string; meterType: MeterTypeName };
  meterType: MeterTypeName;
  company: { id: string; name: string };
  fuelType: FuelTypeName;
  currentMeter: number;
  quotaMode: "INHERIT" | "CUSTOM" | "EXEMPT";
  isActive: boolean;
  hasActiveQrToken: boolean;
}

const columnHelper = createColumnHelper<VehicleRow>();

export interface VehicleTableProps {
  vehicles: VehicleRow[];
  isLoading: boolean;
  canEdit: boolean;
  onEdit: (vehicle: VehicleRow) => void;
}

export function VehicleTable({ vehicles, isLoading, canEdit, onEdit }: VehicleTableProps) {
  const columns = [
    columnHelper.accessor("plateNumber", {
      header: "Plate",
      cell: (info) => <span className="font-semibold">{info.getValue()}</span>,
    }),
    columnHelper.accessor((row) => row.company.name, { id: "company", header: "Company" }),
    columnHelper.accessor((row) => row.vehicleType.name, { id: "type", header: "Type" }),
    columnHelper.accessor("fuelType", {
      header: "Fuel",
      cell: (info) => (
        <Badge variant={FUEL_CONFIG[info.getValue()].badgeVariant}>
          {fuelLabel(info.getValue())}
        </Badge>
      ),
    }),
    columnHelper.accessor("currentMeter", {
      header: "Meter",
      cell: (info) => formatMeter(info.getValue(), info.row.original.meterType),
    }),
    columnHelper.accessor("hasActiveQrToken", {
      header: "QR token",
      cell: (info) =>
        info.getValue() ? (
          <span className="inline-flex items-center gap-1.5 text-success">
            <StatusIcon kind="success" /> Active
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-muted">
            <StatusIcon kind="warning" /> None
          </span>
        ),
    }),
    columnHelper.accessor("isActive", {
      header: "Status",
      cell: (info) =>
        info.getValue() ? (
          <Badge variant="success">Active</Badge>
        ) : (
          <Badge variant="outline">Inactive</Badge>
        ),
    }),
    ...(canEdit
      ? [
          columnHelper.display({
            id: "actions",
            header: "",
            cell: (info) => (
              <Button variant="ghost" size="sm" onClick={() => onEdit(info.row.original)}>
                Edit
              </Button>
            ),
          }),
        ]
      : []),
  ];

  const table = useReactTable({
    data: vehicles,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <TableContainer>
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id}>
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </tr>
          ))}
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="py-8 text-center text-muted">
                Loading vehicles…
              </TableCell>
            </TableRow>
          ) : table.getRowModel().rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="py-8 text-center text-muted">
                No vehicles yet.
              </TableCell>
            </TableRow>
          ) : (
            table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
