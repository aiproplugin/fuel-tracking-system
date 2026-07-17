"use client";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatQuotaPair, type QuotaPeriodName } from "@/lib/format";

export interface CompanyRow {
  id: string;
  name: string;
  siteCount: number;
  vehicleCount: number;
  defaultQuotaLiters: number | null;
  defaultQuotaPeriod: QuotaPeriodName | null;
}

export interface CompanyTableProps {
  companies: CompanyRow[];
  isLoading: boolean;
  canEdit: boolean;
  onEdit: (company: CompanyRow) => void;
  onDelete: (company: CompanyRow) => void;
}

export function CompanyTable({
  companies,
  isLoading,
  canEdit,
  onEdit,
  onDelete,
}: CompanyTableProps) {
  const columnCount = canEdit ? 5 : 4;
  return (
    <TableContainer>
      <Table>
        <TableHeader>
          <tr>
            <TableHead>Company</TableHead>
            <TableHead>Sites</TableHead>
            <TableHead>Vehicles</TableHead>
            <TableHead>Default quota</TableHead>
            {canEdit ? <TableHead /> : null}
          </tr>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={columnCount} className="py-8 text-center text-muted">
                Loading companies…
              </TableCell>
            </TableRow>
          ) : companies.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columnCount} className="py-8 text-center text-muted">
                No companies yet. Sites and vehicles need an owning company, so add one first.
              </TableCell>
            </TableRow>
          ) : (
            companies.map((company) => {
              const attached = company.siteCount > 0 || company.vehicleCount > 0;
              return (
                <TableRow key={company.id}>
                  <TableCell className="font-semibold">{company.name}</TableCell>
                  <TableCell className="text-muted">{company.siteCount}</TableCell>
                  <TableCell className="text-muted">{company.vehicleCount}</TableCell>
                  <TableCell className="text-muted">
                    {company.defaultQuotaLiters !== null && company.defaultQuotaPeriod !== null
                      ? formatQuotaPair(company.defaultQuotaLiters, company.defaultQuotaPeriod)
                      : "—"}
                  </TableCell>
                  {canEdit ? (
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => onEdit(company)}>
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-danger hover:text-danger"
                          onClick={() => onDelete(company)}
                          disabled={attached}
                          title={
                            attached
                              ? "Reassign all sites and vehicles before deleting this company."
                              : undefined
                          }
                        >
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
