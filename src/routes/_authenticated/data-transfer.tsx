import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { AppShell, Panel, StatCard } from "@/components/AppShell";
import {
  SPECS,
  type ImportResult,
  type Row,
  type Spec,
  exportSpec,
  importSpec,
  loadCtx,
  templateRow,
} from "@/lib/data-io";

export const Route = createFileRoute("/_authenticated/data-transfer")({
  head: () => ({
    meta: [
      { title: "Import & export — AIONOS HR Control Tower" },
      {
        name: "description",
        content:
          "Move real HR data in and out of the system with Excel workbooks: people, salary, leave, timesheets, payroll, hiring, learning, benefits and documents.",
      },
      { property: "og:title", content: "Import & export — AIONOS HR Control Tower" },
      { property: "og:description", content: "Excel import and export for every HR record." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <AppShell title="Import & export" subtitle="Excel in · Excel out">
      <DataTransferBody />
    </AppShell>
  ),
});

async function xlsx() {
  return await import("xlsx");
}

function download(name: string, sheets: { name: string; rows: Row[] }[], XLSX: typeof import("xlsx")) {
  const wb = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const ws = XLSX.utils.json_to_sheet(sheet.rows.length ? sheet.rows : [{}]);
    XLSX.utils.book_append_sheet(wb, ws, sheet.name.slice(0, 31));
  }
  XLSX.writeFile(wb, name);
}

function DataTransferBody() {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState("");
  const [results, setResults] = useState<Record<string, ImportResult>>({});
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  const stamp = new Date().toISOString().slice(0, 10);

  const exportOne = async (spec: Spec) => {
    setBusy(spec.key);
    try {
      const XLSX = await xlsx();
      const ctx = await loadCtx();
      const rows = await exportSpec(spec, ctx);
      download(`${spec.key}-${stamp}.xlsx`, [{ name: spec.label, rows }], XLSX);
      toast.success(`${spec.label}: ${rows.length} rows exported`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const exportAll = async () => {
    setBusy("all");
    try {
      const XLSX = await xlsx();
      const ctx = await loadCtx();
      const sheets: { name: string; rows: Row[] }[] = [];
      for (const spec of SPECS) sheets.push({ name: spec.label, rows: await exportSpec(spec, ctx) });
      download(`hrms-export-${stamp}.xlsx`, sheets, XLSX);
      toast.success("Full export downloaded");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const downloadTemplates = async () => {
    setBusy("template");
    try {
      const XLSX = await xlsx();
      download(
        `hrms-import-template-${stamp}.xlsx`,
        SPECS.map((s) => ({ name: s.label, rows: [templateRow(s)] })),
        XLSX,
      );
      toast.success("Blank template downloaded");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const runImport = async (spec: Spec, file: File) => {
    setBusy(spec.key);
    try {
      const XLSX = await xlsx();
      const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
      const sheetName =
        wb.SheetNames.find((n) => n.toLowerCase() === spec.label.toLowerCase()) ?? wb.SheetNames[0]!;
      const rows = XLSX.utils.sheet_to_json<Row>(wb.Sheets[sheetName]!, { defval: "", raw: false });
      const ctx = await loadCtx();
      const result = await importSpec(spec, rows, ctx);
      setResults((r) => ({ ...r, [spec.key]: result }));
      queryClient.invalidateQueries();
      if (result.inserted || result.updated) {
        toast.success(
          `${spec.label}: ${result.inserted} added, ${result.updated} updated${
            result.skipped.length ? `, ${result.skipped.length} skipped` : ""
          }`,
        );
      } else {
        toast.error(`${spec.label}: nothing imported${result.skipped.length ? " — check the skipped rows" : ""}`);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  return (
    <>
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-line ring-1 ring-black/5 rounded-[14px] overflow-hidden">
        <StatCard label="Data sets" value={SPECS.length} hint="available both ways" />
        <StatCard label="File format" value="Excel" hint=".xlsx workbooks" />
        <StatCard
          label="Matching"
          value="By email"
          hint="people are linked by their work email"
        />
      </section>

      <Panel
        title="Whole system"
        meta={
          <div className="flex items-center gap-2">
            <button
              onClick={downloadTemplates}
              disabled={!!busy}
              className="h-8 px-3 rounded-md ring-1 ring-line text-[12px] font-medium cursor-pointer hover:bg-ink/5 inline-flex items-center gap-1.5 disabled:opacity-60"
            >
              <FileSpreadsheet className="size-3.5" /> Blank template
            </button>
            <button
              onClick={exportAll}
              disabled={!!busy}
              className="h-8 px-3 rounded-md bg-brand text-paper text-[12px] font-semibold cursor-pointer hover:bg-brand-deep inline-flex items-center gap-1.5 disabled:opacity-60"
            >
              <Download className="size-3.5" />
              {busy === "all" ? "Preparing…" : "Export everything"}
            </button>
          </div>
        }
      >
        <p className="px-4 py-3 text-[12.5px] text-ink-soft">
          Download one workbook with a sheet for every data set, or start from the blank template.
          Fill a sheet and upload it below. Rows that already exist are updated, new rows are added.
          Import people first — every other sheet links to them by work email.
        </p>
      </Panel>

      <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
        {SPECS.map((spec) => {
          const result = results[spec.key];
          return (
            <Panel key={spec.key} title={spec.label}>
              <div className="p-4 space-y-3">
                <p className="text-[12.5px] text-ink-soft">{spec.hint}</p>
                <p className="text-[11px] font-mono text-ink-soft break-words">
                  {spec.fields.map((f) => f.header).join(" · ")}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => exportOne(spec)}
                    disabled={!!busy}
                    className="h-8 px-3 rounded-md ring-1 ring-line text-[12px] font-medium cursor-pointer hover:bg-ink/5 inline-flex items-center gap-1.5 disabled:opacity-60"
                  >
                    <Download className="size-3.5" /> Export
                  </button>
                  <button
                    onClick={() => inputs.current[spec.key]?.click()}
                    disabled={!!busy}
                    className="h-8 px-3 rounded-md bg-brand text-paper text-[12px] font-semibold cursor-pointer hover:bg-brand-deep inline-flex items-center gap-1.5 disabled:opacity-60"
                  >
                    <Upload className="size-3.5" />
                    {busy === spec.key ? "Working…" : "Import"}
                  </button>
                  <input
                    ref={(el) => {
                      inputs.current[spec.key] = el;
                    }}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (file) void runImport(spec, file);
                    }}
                  />
                </div>
                {result && (
                  <div className="rounded-md ring-1 ring-line p-3 space-y-1">
                    <p className="text-[12px] font-medium">
                      {result.inserted} added · {result.updated} updated · {result.skipped.length} skipped
                    </p>
                    {result.skipped.slice(0, 5).map((s) => (
                      <p key={s.row} className="text-[11px] font-mono text-ink-soft">
                        Row {s.row}: {s.reason}
                      </p>
                    ))}
                    {result.skipped.length > 5 && (
                      <p className="text-[11px] font-mono text-ink-soft">
                        …and {result.skipped.length - 5} more
                      </p>
                    )}
                  </div>
                )}
              </div>
            </Panel>
          );
        })}
      </div>
    </>
  );
}
