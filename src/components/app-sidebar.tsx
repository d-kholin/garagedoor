"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Boxes,
  DoorOpen,
  KeyRound,
  Moon,
  Network,
  RefreshCcwDot,
  Sun,
} from "lucide-react";
import { useTheme } from "next-themes";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useGarage } from "@/lib/api";
import type { ClusterHealth } from "@/lib/garage/types";
import { cn } from "@/lib/utils";

const NAV = [
  { title: "Dashboard", href: "/", icon: Activity },
  { title: "Replication", href: "/replication", icon: RefreshCcwDot },
  { title: "Buckets", href: "/buckets", icon: Boxes },
  { title: "Access Keys", href: "/keys", icon: KeyRound },
  { title: "Cluster Layout", href: "/cluster", icon: Network },
];

function HealthDot() {
  const { data } = useGarage<ClusterHealth>("GetClusterHealth", {
    refreshInterval: 10_000,
  });
  const status = data?.status;
  return (
    <span className="flex items-center gap-2 text-xs text-muted-foreground">
      <span
        className={cn(
          "size-2 rounded-full",
          status === "healthy" && "bg-emerald-500",
          status === "degraded" && "bg-amber-500",
          status === "unavailable" && "bg-red-500",
          !status && "bg-muted-foreground/40",
        )}
      />
      {status ?? "connecting…"}
    </span>
  );
}

export function AppSidebar() {
  const pathname = usePathname();
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <DoorOpen className="size-5" />
          <div className="flex flex-col">
            <span className="font-semibold leading-tight">Garagedoor</span>
            <HealthDot />
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Cluster</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    render={<Link href={item.href} />}
                    isActive={
                      item.href === "/"
                        ? pathname === "/"
                        : pathname.startsWith(item.href)
                    }
                  >
                    <item.icon />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            >
              <Sun className="dark:hidden" />
              <Moon className="hidden dark:block" />
              <span>Toggle theme</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
