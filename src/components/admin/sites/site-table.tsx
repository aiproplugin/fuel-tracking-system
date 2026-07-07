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

export interface SiteRow {
  id: string;
  name: string;
  tankCount: number;
  userCount: number;
}

export interface SiteTableProps {
  sites: SiteRow[];
  isLoading: boolean;
  canEdit: boolean;
  onEdit: (site: SiteRow) => void;
  onDelete: (site: SiteRow) => void;
}

export function SiteTable({ sites, isLoading, canEdit, onEdit, onDelete }: SiteTableProps) {
  const columnCount = canEdit ? 4 : 3;
  return (
    <TableContainer>
      <Table>
        <TableHeader>
          <tr>
            <TableHead>Site</TableHead>
            <TableHead>Tanks</TableHead>
            <TableHead>Users</TableHead>
            {canEdit ? <TableHead /> : null}
          </tr>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={columnCount} className="py-8 text-center text-muted">
                Loading sites…
              </TableCell>
            </TableRow>
          ) : sites.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columnCount} className="py-8 text-center text-muted">
                No sites yet. Add one to start assigning tanks and users.
              </TableCell>
            </TableRow>
          ) : (
            sites.map((site) => {
              const attached = site.tankCount > 0 || site.userCount > 0;
              return (
                <TableRow key={site.id}>
                  <TableCell className="font-semibold">{site.name}</TableCell>
                  <TableCell className="text-muted">{site.tankCount}</TableCell>
                  <TableCell className="text-muted">{site.userCount}</TableCell>
                  {canEdit ? (
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => onEdit(site)}>
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-danger hover:text-danger"
                          onClick={() => onDelete(site)}
                          disabled={attached}
                          title={
                            attached
                              ? "Detach all tanks and users before deleting this site."
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
