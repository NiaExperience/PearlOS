"use client";

import { useCallback, useEffect, useState } from "react";

import { agencyBossById, type AgencyBossId } from "@interface/lib/agency-roster";

type AgencyBossApiResponse = {
  boss?: AgencyBossId;
  updatedAt?: string;
  restart?: { ok: boolean; message: string };
};

export function useAgencyBoss() {
  const [boss, setBoss] = useState<AgencyBossId>("codex");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<AgencyBossId | null>(null);
  const [canManage, setCanManage] = useState(true);
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/agency-boss", { cache: "no-store" });
      if (response.status === 401 || response.status === 403) {
        setCanManage(false);
        setStatus("Agency Boss controls are admin-only.");
        return;
      }
      const data = (await response.json()) as AgencyBossApiResponse;
      if (response.ok && data.boss) {
        setCanManage(true);
        const profile = agencyBossById(data.boss);
        setBoss(profile.id);
        setStatus(data.updatedAt ? `Updated ${new Date(data.updatedAt).toLocaleString()}` : "");
      } else if (!response.ok) {
        setStatus(`Could not read Agency Boss (${response.status}).`);
      }
    } catch {
      setStatus("Could not read Agency Boss.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const updateBoss = useCallback(async (nextBoss: AgencyBossId) => {
    if (saving || nextBoss === boss) return;
    setSaving(nextBoss);
    setStatus("Applying...");
    try {
      const response = await fetch("/api/agency-boss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ boss: nextBoss, apply: true }),
      });
      const data = (await response.json().catch(() => ({}))) as AgencyBossApiResponse;
      if (!response.ok || data.restart?.ok === false) {
        throw new Error(data.restart?.message || `Agency Boss update failed (${response.status})`);
      }
      const profile = agencyBossById(data.boss || nextBoss);
      setBoss(profile.id);
      setStatus(`${profile.label} is Agency Boss.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not change Agency Boss.");
    } finally {
      setSaving(null);
    }
  }, [boss, saving]);

  return { boss, loading, saving, canManage, status, reload: load, updateBoss };
}
