import { PageHeader } from "@/components/admin/page-header";
import { Card, CardContent } from "@/components/ui/card";

/** Honest placeholder for nav items whose flows land in a later phase. */
export function ComingSoon({
  eyebrow,
  title,
  phase,
  description,
}: {
  eyebrow: string;
  title: string;
  phase: string;
  description: string;
}) {
  return (
    <div className="space-y-6">
      <PageHeader eyebrow={eyebrow} title={title} />
      <Card>
        <CardContent>
          <p className="font-bold">Arrives in {phase}</p>
          <p className="mt-2 text-sm text-muted">{description}</p>
        </CardContent>
      </Card>
    </div>
  );
}
