"use client";

import {
  requestWindowClose,
  requestWindowOpen,
} from "@interface/features/ManeuverableWindow/lib/windowLifecycleController";

type StudioProjectType = "game" | "app" | "feature" | "pearlos";

export interface StudioPlayableProject {
  id: string;
  title: string;
  type: StudioProjectType;
  playUrl?: string;
}

function playUrlFor(project: StudioPlayableProject): string {
  if (project.playUrl?.trim()) return project.playUrl.trim();
  return `/api/creation/${encodeURIComponent(project.id)}/`;
}

export function openStudioCreation(project: StudioPlayableProject, source: string): void {
  const playUrl = playUrlFor(project);

  requestWindowClose({ all: true, source });

  window.setTimeout(() => {
    requestWindowOpen({
      viewType: "miniBrowser",
      title: project.title,
      viewState: { browserUrl: playUrl, miniBrowserPresentation: "seamless" },
      meta: {
        creationId: project.id,
        launchpadProjectId: project.id,
        playUrl,
        fullscreen: true,
      },
      source,
      options: { allowDuplicate: false },
    });

    window.dispatchEvent(
      new CustomEvent("nia.launchpad.project.launch", {
        detail: {
          projectId: project.id,
          title: project.title,
          type: project.type,
          playUrl,
        },
      })
    );
  }, 0);
}
