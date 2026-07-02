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
import { formatKilometers } from "@/lib/format";

export interface VehicleRow {
  id: string;
  plateNumber: string;
  vehicleType: { id: string; name: string };
  fuelType: "PETROL" | "DIESEL";
  currentOdometer: number;
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
    columnHelper.accessor((row) => row.vehicleType.name, { id: "type", header: "Type" }),
    columnHelper.accessor("fuelType", {
      header: "Fuel",
      cell: (info) => (
        <Badge variant={info.getValue() === "PETROL" ? "petrol" : "diesel"}>
          {info.getValue() === "PETROL" ? "Petrol" : "Diesel"}
        </Badge>
      ),
    }),
    columnHelper.accessor("currentOdometer", {
      header: "Odometer",
      cell: (info) => formatKilometers(info.getValue()),
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
