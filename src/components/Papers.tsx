import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { friendlyError } from "../lib/ui";

/** The papers a family has or still needs. File storage via upload URLs. */
export function Papers({
  estateId,
  canEdit,
  onNotice,
}: {
  estateId: Id<"estates">;
  canEdit: boolean;
  onNotice: (s: string) => void;
}) {
  const docs = useQuery(api.estates.documents, { estateId });
  const setStatus = useMutation(api.estates.setDocumentStatus);
  const addDocument = useMutation(api.estates.addDocument);
  const uploadUrl = useMutation(api.estates.documentUploadUrl);
  const attach = useMutation(api.estates.attachDocumentFile);
  const [adding, setAdding] = useState("");
  const [uploading, setUploading] = useState<string | null>(null);
  const fileFor = useRef<Id<"documents"> | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const onFile = async (file: File | undefined) => {
    const id = fileFor.current;
    if (!file || !id) return;
    setUploading(id);
    try {
      const url = await uploadUrl({ estateId });
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
      const { storageId } = await res.json();
      await attach({ documentId: id, storageId });
    } catch (e) {
      onNotice(friendlyError(e));
    } finally {
      setUploading(null);
      fileFor.current = null;
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  return (
    <section className="rounded-2xl border border-line bg-card p-4">
      <h2 className="serif text-lg">Papers</h2>
      <p className="mt-1 text-xs text-ink-3">Companies usually ask for these. Tick what you have.</p>
      <ul className="mt-3 space-y-1">
        {(docs ?? []).map((d) => (
          <li key={d._id} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-sage"
              checked={d.status === "have"}
              disabled={!canEdit}
              onChange={(e) => setStatus({ documentId: d._id, status: e.target.checked ? "have" : "need" }).catch((err) => onNotice(friendlyError(err)))}
            />
            <span className={`flex-1 ${d.status === "have" ? "text-ink-2" : ""}`}>{d.name}</span>
            {d.url ? (
              <a href={d.url} target="_blank" rel="noreferrer" className="text-xs text-mist hover:underline">
                file
              </a>
            ) : canEdit ? (
              <button
                className="text-xs text-ink-3 hover:text-ink"
                disabled={uploading === d._id}
                onClick={() => {
                  fileFor.current = d._id;
                  fileInput.current?.click();
                }}
              >
                {uploading === d._id ? "uploading" : "attach"}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      <input ref={fileInput} type="file" className="hidden" accept=".pdf,image/*" onChange={(e) => onFile(e.target.files?.[0])} />
      {canEdit && (
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!adding.trim()) return;
            addDocument({ estateId, name: adding }).catch((err) => onNotice(friendlyError(err)));
            setAdding("");
          }}
        >
          <input
            className="min-w-0 flex-1 rounded-xl border border-line-2 bg-card px-3 py-1.5 text-sm placeholder:text-ink-3 focus:border-sand focus:outline-none"
            placeholder="Add a paper…"
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
          />
        </form>
      )}
      <p className="mt-3 text-[11px] leading-snug text-ink-3">
        This is a demonstration. Please do not upload a real death certificate here.
      </p>
    </section>
  );
}
