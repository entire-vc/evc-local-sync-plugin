import { TAbstractFile, TFile } from "obsidian";
import type EVCLocalSyncPlugin from "./main";

interface TRAuthResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

interface TRFileEntry {
  id?: string;
  doc_id?: string;
}

interface TRFilesResponse {
  files?: Record<string, TRFileEntry>;
}

function toCanonicalKey(relPath: string): string {
  return (
    "canonical:" +
    relPath
      .replace(/\.md$/i, "")
      .toLowerCase()
      .replace(/[/\s_]+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
  );
}

function resolveProjectId(
  relPath: string,
  map: Array<{ prefix: string; projectId: string }> | undefined
): string {
  if (!map || map.length === 0) return "";
  for (const entry of map) {
    if (relPath.startsWith(entry.prefix)) return entry.projectId;
  }
  return map[map.length - 1]?.projectId ?? "";
}

export class KnowledgeCanonicalWatcher {
  private readonly KNOWLEDGE_PREFIX = "Entire VC/Knowledge/";
  private trToken: string | null = null;

  constructor(private readonly plugin: EVCLocalSyncPlugin) {}

  register(): void {
    this.plugin.registerEvent(
      this.plugin.app.vault.on("modify", (file) =>
        void this.handleKnowledgeFile(file)
      )
    );
    this.plugin.registerEvent(
      this.plugin.app.vault.on("create", (file) =>
        void this.handleKnowledgeFile(file)
      )
    );
    this.plugin.registerEvent(
      this.plugin.app.vault.on("rename", (file) =>
        void this.handleKnowledgeFile(file)
      )
    );
  }

  private async handleKnowledgeFile(file: TAbstractFile): Promise<void> {
    const s = this.plugin.settings;
    if (!s.knowledgeCanonicalEnabled) return;
    if (!(file instanceof TFile)) return;
    if (!file.path.startsWith(this.KNOWLEDGE_PREFIX)) return;
    if (!file.path.endsWith(".md")) return;

    const relPath = file.path.slice(this.KNOWLEDGE_PREFIX.length);
    const key = toCanonicalKey(relPath);
    const projectId = resolveProjectId(relPath, s.knowledgeFolderProjectMap);

    let content: string;
    try {
      content = await this.plugin.app.vault.read(file);
    } catch (err) {
      console.error("EVC Knowledge Canonical: failed to read file", err);
      return;
    }

    await Promise.allSettled([
      this.pushToTeamRelay(relPath, content),
      this.pushToMesh(projectId, key, relPath, content),
    ]);
  }

  private async getTRToken(): Promise<string> {
    if (this.trToken) return this.trToken;
    const { trBaseUrl, trEmail, trPassword } = this.plugin.settings;
    const res = await fetch(`${trBaseUrl}/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: trEmail, password: trPassword }),
    });
    if (!res.ok) throw new Error(`TR auth failed: ${res.status}`);
    const data = (await res.json()) as TRAuthResponse;
    this.trToken = data.access_token;
    return this.trToken;
  }

  private async pushToTeamRelay(relPath: string, content: string): Promise<void> {
    const { trBaseUrl, trShareId, trEmail, trPassword } = this.plugin.settings;
    if (!trEmail || !trPassword || !trBaseUrl || !trShareId) return;

    try {
      let token = await this.getTRToken();

      // List existing files
      let filesRes = await fetch(
        `${trBaseUrl}/v1/documents/${trShareId}/files?share_id=${trShareId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (filesRes.status === 401) {
        this.trToken = null;
        token = await this.getTRToken();
        filesRes = await fetch(
          `${trBaseUrl}/v1/documents/${trShareId}/files?share_id=${trShareId}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
      }

      if (!filesRes.ok) throw new Error(`TR files list failed: ${filesRes.status}`);

      const filesData = (await filesRes.json()) as TRFilesResponse;
      const existing = filesData.files?.[relPath];
      const docId = existing?.id ?? existing?.doc_id;

      if (docId) {
        const r = await fetch(`${trBaseUrl}/v1/documents/${docId}/content`, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ share_id: trShareId, content, key: "contents" }),
        });
        if (!r.ok) throw new Error(`TR PUT failed: ${r.status}`);
      } else {
        const r = await fetch(`${trBaseUrl}/v1/documents/${trShareId}/files`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ share_id: trShareId, path: relPath, content }),
        });
        if (!r.ok) throw new Error(`TR POST failed: ${r.status}`);
      }
    } catch (err) {
      console.error("EVC Knowledge Canonical: TR push failed", err);
    }
  }

  private async pushToMesh(
    projectId: string,
    key: string,
    relPath: string,
    content: string
  ): Promise<void> {
    const { meshBaseUrl, meshApiKey } = this.plugin.settings;
    if (!meshBaseUrl || !meshApiKey || !projectId) return;

    try {
      const res = await fetch(
        `${meshBaseUrl}/api/v1/projects/${projectId}/knowledge`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Agent-Key": meshApiKey,
          },
          body: JSON.stringify({
            key,
            value: content.slice(0, 4000),
            category: "canonical",
            tags: ["obsidian", "knowledge", "source:obsidian"],
            source_url: `obsidian://open?vault=${encodeURIComponent(this.plugin.app.vault.getName())}&file=${encodeURIComponent(relPath)}`,
          }),
        }
      );
      if (!res.ok) throw new Error(`Mesh push failed: ${res.status}`);
    } catch (err) {
      console.error("EVC Knowledge Canonical: Mesh push failed", err);
    }
  }
}
