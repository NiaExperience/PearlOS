"use client";

import React from "react";
import { requestWindowOpen } from "@interface/features/ManeuverableWindow/lib/windowLifecycleController";
import type { ViewType } from "@interface/features/ManeuverableWindow/lib/windowLifecycleController";
import { useDesktopMode } from "@interface/contexts/desktop-mode-context";
import { DesktopMode } from "@interface/types/desktop-modes";
import Image from "next/image";
import { useInterfaceCustomization } from "@interface/hooks/use-interface-customization";
import { getIconOverride, shouldBypassNextImageOptimization } from "@interface/lib/interface-customization";
import { dispatchPearlSettingsOpen } from "@interface/lib/webchat-onboarding";

interface DesktopIcon {
  viewType: ViewType;
  label: string;
  icon: string;
  imageSrc?: string;
  imageAlt?: string;
  pixelated?: boolean;
  url?: string;
  title?: string;
  customIcon?: React.ReactNode;
}

const DESKTOP_ICONS: DesktopIcon[] = [
  { viewType: "council", label: "Council", icon: "C", imageSrc: "/icons/council.svg", imageAlt: "Council", pixelated: true, title: "Council" },
  { viewType: "agency", label: "The Agency", icon: "🏛️", imageSrc: "/icons/agency-building.svg", imageAlt: "The Agency", pixelated: true, title: "The Agency" },
  { viewType: "studio", label: "The Studio", icon: "🧭", imageSrc: "/icons/studio-pyramid.svg", imageAlt: "The Studio", pixelated: true, title: "The Studio" },
  { viewType: "creation", label: "Creation Lab", icon: "🎨", imageSrc: "/desktopicons/creationengine.png", imageAlt: "Creation Lab", title: "Creation Lab" },
  { viewType: "ourPearlos", label: "Our PearlOS", icon: "🤝", imageSrc: "/icons/pearl-clam.svg", imageAlt: "Our PearlOS", pixelated: true, title: "Our PearlOS" },
  { viewType: "notes", label: "Notes", icon: "📝", imageSrc: "/desktopicons/notepad.png", imageAlt: "Notes" },
  { viewType: "youtube", label: "YouTube", icon: "▶️", imageSrc: "/desktopicons/youtube.png", imageAlt: "YouTube" },
  { viewType: "news", label: "News", icon: "📰", imageSrc: "/desktopicons/news.png", imageAlt: "News" },
  { viewType: "pulse", label: "Pulse", icon: "📡", imageSrc: "/desktopicons/social.png", imageAlt: "Pulse" },
  { viewType: "weather", label: "Weather", icon: "🌤️", imageSrc: "/desktopicons/weather.png", imageAlt: "Weather" },
  { viewType: "files", label: "FileSpace", icon: "📁", imageSrc: "/desktopicons/files.png", imageAlt: "FileSpace", title: "FileSpace" },
  { viewType: "terminal", label: "Terminal", icon: "⬛", imageSrc: "/desktopicons/Terminal.png", imageAlt: "Terminal" },
  { viewType: "discord", label: "Discord", icon: "💬", imageSrc: "/desktopicons/discord.png", imageAlt: "Discord" },
  { viewType: "styles", label: "Styles", icon: "🎨", imageSrc: "/ThemeIco.png", imageAlt: "Styles", pixelated: true, title: "Styles" },
  { viewType: "settings", label: "Settings", icon: "⚙️", imageSrc: "/pixel-ui/icons/settings.png", imageAlt: "Settings", pixelated: true },
  { viewType: "browser", label: "Web Browser", icon: "🌐", imageSrc: "/desktopicons/chrome.png", imageAlt: "Web Browser", url: "https://pearlos.org", title: "Web Browser" },
];

const DesktopIconGrid: React.FC = () => {
  const { currentMode } = useDesktopMode();
  const customization = useInterfaceCustomization();

  const handleIconClick = (icon: DesktopIcon) => {
    if (icon.viewType === "settings") {
      dispatchPearlSettingsOpen("connections");
      return;
    }
    requestWindowOpen({
      viewType: icon.viewType,
      source: "desktop-icon",
      title: icon.title || icon.label,
      url: icon.url,
    });
  };

  const handleIconImageError = (event: React.SyntheticEvent<HTMLImageElement>, fallback: string) => {
    if (!fallback) return;
    const image = event.currentTarget;
    const current = image.getAttribute("src") || "";
    if (current.includes(fallback)) return;
    image.src = fallback;
  };

  // Home screen shows the sunset scene with clickable building cutouts; the
  // app launcher grid only belongs in WORK/DESKTOP modes.
  if (currentMode === DesktopMode.HOME) {
    return null;
  }

  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        left: 12,
        bottom: 0,
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, 64px)",
        gridAutoRows: "max-content",
        gap: 6,
        maxWidth: 360,
        paddingBottom: 48, /* keep icons above the compact chat bar (~40px + margin) */
        zIndex: 10, /* above chat bar drag overlay (z-4), below expanded chat (z-50) */
        pointerEvents: "auto",
        overflow: "hidden",
      }}
    >
      {DESKTOP_ICONS.map((icon) => {
        const resolvedIconSrc = icon.imageSrc
          ? getIconOverride(customization.icons, String(icon.viewType), icon.imageSrc)
          : '';
        return (
          <button
            key={icon.viewType}
            onClick={() => handleIconClick(icon)}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 3,
              width: 60,
              height: 60,
              background: "transparent",
              border: "none",
              borderRadius: 12,
              cursor: "pointer",
              padding: 3,
              transition: "background 0.15s",
              color: "var(--pearl-icon-label, #faf8f5)",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget.style.background) = "var(--pearl-window-tab-bg, rgba(255,255,255,0.08))";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget.style.background) = "transparent";
            }}
            aria-label={`Open ${icon.label}`}
          >
            <span
              style={{
                width: 46,
                height: 46,
                lineHeight: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 10,
                border: "1px solid rgba(0,0,0,0.45)",
                background: "rgba(0,0,0,0.3)",
                boxShadow: "0 8px 22px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.16)",
                backdropFilter: "blur(1px)",
              }}
            >
              {icon.customIcon || (icon.imageSrc ? (
                <Image
                  src={resolvedIconSrc}
                  width={42}
                  height={42}
                  alt={icon.imageAlt || icon.label}
                  unoptimized={shouldBypassNextImageOptimization(resolvedIconSrc)}
                  onError={(event) => handleIconImageError(event, icon.imageSrc || "")}
                  style={{ objectFit: "contain", imageRendering: "pixelated" }}
                />
              ) : (
                <span style={{ fontSize: 22 }}>{icon.icon}</span>
              ))}
            </span>
            <span
              className="pearl-desktop-icon-label"
              style={{
                fontSize: 9,
                fontFamily: "var(--pearl-ui-font, Gohufont, monospace)",
                textAlign: "center",
                lineHeight: 1.2,
                textShadow: "0 1px 4px rgba(0,0,0,0.7)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                maxWidth: "100%",
              }}
            >
              {icon.label}
            </span>
          </button>
        );
      })}
    </div>
  );
};

export default DesktopIconGrid;
