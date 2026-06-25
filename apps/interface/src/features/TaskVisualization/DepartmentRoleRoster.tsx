"use client";

import React from "react";

import {
  AGENCY_DEPARTMENTS,
  modelOptionById,
  type AgencyDepartmentKey,
} from "@interface/lib/agency-roster";

type Props = {
  assignments: Record<string, string>;
  onAssignmentChange: (roleId: string, modelId: string) => void;
};

export function DepartmentRoleRoster({ assignments, onAssignmentChange }: Props) {
  const [departmentKey, setDepartmentKey] = React.useState<AgencyDepartmentKey>("code");
  const [openRoleId, setOpenRoleId] = React.useState<string | null>(null);
  const department = AGENCY_DEPARTMENTS.find((item) => item.key === departmentKey) || AGENCY_DEPARTMENTS[0];

  return (
    <section className="pearl-themed-app-surface grid gap-3 rounded-[8px] border p-3" style={{ fontFamily: "Gohufont, monospace" }}>
      <div className="flex flex-wrap items-center gap-2">
        {AGENCY_DEPARTMENTS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => {
              setDepartmentKey(item.key);
              setOpenRoleId(null);
            }}
            className={`rounded border px-2.5 py-1.5 text-[11px] font-bold ${item.key === departmentKey ? "border-sky-300/60 bg-sky-300/12 text-white" : "border-white/10 bg-white/[0.03] text-white/55 hover:text-white"}`}
          >
            {item.title}
          </button>
        ))}
      </div>

      <div className="grid gap-1">
        <div className="text-sm font-bold text-white">{department.title} Roles</div>
        <div className="text-[11px] leading-snug text-white/48">{department.description}</div>
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        {department.roles.map((role) => {
          const currentModel = assignments[role.id] || role.defaultModelId;
          const current = modelOptionById(currentModel);
          const open = openRoleId === role.id;
          return (
            <div key={role.id} className="rounded-[8px] border border-white/10 bg-black/20 p-2">
              <button
                type="button"
                onClick={() => setOpenRoleId(open ? null : role.id)}
                className="flex w-full items-center gap-2 text-left"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-bold text-white">{role.title}</span>
                  <span className="mt-0.5 block text-[10px] leading-snug text-white/44">{role.description}</span>
                </span>
                <span className="max-w-[150px] truncate rounded border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] text-sky-100">
                  {current.label}
                </span>
              </button>

              {open ? (
                <div className="mt-2 grid gap-1.5 border-t border-white/10 pt-2">
                  {role.options.map((modelId) => {
                    const option = modelOptionById(modelId);
                    const selected = option.id === current.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => onAssignmentChange(role.id, option.id)}
                        className={`rounded border px-2 py-1.5 text-left ${selected ? "border-sky-300/60 bg-sky-300/12" : "border-white/10 bg-white/[0.03] hover:border-white/25"}`}
                      >
                        <span className="block text-[11px] font-bold text-white">{option.label}</span>
                        <span className="mt-0.5 block text-[10px] leading-snug text-white/45">{option.description}</span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
