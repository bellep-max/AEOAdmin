import { useState, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Upload } from "lucide-react";

interface ImportResult {
  imported: number;
  skipped: number;
  totalRows: number;
  errors: { row: number; reason: string }[];
  errorsTruncated?: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function ImportSessionsDialog({ open, onOpenChange, onSuccess }: Props) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setFile(e.target.files?.[0] ?? null);
  }

  async function handleUpload() {
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
      const res = await fetch(`${BASE}/api/sessions/import`, {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error ?? `Upload failed (HTTP ${res.status})`);
      }

      const result: ImportResult = await res.json();
      const errorCount = result.errors.length + (result.errorsTruncated ?? 0);

      if (errorCount > 0) {
        toast({
          title: "Import completed with issues",
          description: `Imported ${result.imported}, skipped ${result.skipped} of ${result.totalRows} rows. ${errorCount} errors.`,
        });
      } else {
        toast({
          title: "Import successful",
          description: `Imported ${result.imported} row${result.imported !== 1 ? "s" : ""} (${result.skipped} skipped).`,
        });
      }

      onSuccess();
      onOpenChange(false);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      toast({
        title: "Import failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!uploading) onOpenChange(v); }}>
      <DialogContent className="sm:max-w-[480px] border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-black dark:text-white">Import Sessions CSV</DialogTitle>
          <DialogDescription className="text-slate-600 dark:text-slate-400">
            Upload a daily sessions CSV file from the executor. Rows are automatically mapped to session records.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label htmlFor="csv-file" className="text-sm uppercase tracking-widest text-black dark:text-white font-bold">CSV File</Label>
            <Input
              id="csv-file"
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileChange}
              disabled={uploading}
              className="bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 h-11 text-base text-black dark:text-white"
            />
            {file && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Selected: {file.name} ({(file.size / 1024).toFixed(1)} KB)
              </p>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={uploading} className="border-slate-300 dark:border-slate-600 text-black dark:text-white hover:bg-slate-100 dark:hover:bg-slate-800 text-base font-bold h-11">
              Cancel
            </Button>
            <Button onClick={handleUpload} disabled={!file || uploading} className="gap-2 text-base font-bold h-11" style={{ background: "linear-gradient(135deg,hsl(217,91%,55%),hsl(217,91%,65%))" }}>
              {uploading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Importing...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  Upload & Import
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
