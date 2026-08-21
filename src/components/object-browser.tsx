"use client";

// Read-only object browser. Lists and downloads only — the backing API
// routes implement no write or delete operations at all.

import { useState } from "react";
import useSWR from "swr";
import { Download, File, Folder, Home } from "lucide-react";
import { getFetcher } from "@/lib/api";
import type { BrowseListResponse } from "@/lib/garage/types";
import { formatBytes, formatDate } from "@/lib/format";
import { ErrorBanner } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function ObjectBrowser({
  bucketId,
  bucketName,
}: {
  bucketId: string;
  bucketName: string;
}) {
  const [prefix, setPrefix] = useState("");
  const [token, setToken] = useState<string | undefined>(undefined);
  const [accumulated, setAccumulated] = useState<BrowseListResponse | null>(null);

  const qs = new URLSearchParams({
    bucketId,
    bucketName,
    prefix,
    ...(token ? { continuationToken: token } : {}),
  });
  const { data, error, isLoading } = useSWR<BrowseListResponse>(
    `/api/s3/list?${qs}`,
    getFetcher,
    {
      keepPreviousData: true,
      onSuccess: (page) => {
        setAccumulated((prev) =>
          token && prev && prev.prefix === page.prefix
            ? {
                ...page,
                commonPrefixes: [...prev.commonPrefixes, ...page.commonPrefixes],
                objects: [...prev.objects, ...page.objects],
              }
            : page,
        );
      },
    },
  );

  const view = accumulated?.prefix === prefix ? accumulated : data?.prefix === prefix ? data : null;

  function navigate(newPrefix: string) {
    setPrefix(newPrefix);
    setToken(undefined);
    setAccumulated(null);
  }

  const crumbs = prefix.split("/").filter(Boolean);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              {crumbs.length === 0 ? (
                <BreadcrumbPage className="flex items-center gap-1">
                  <Home className="size-3.5" /> {bucketName}
                </BreadcrumbPage>
              ) : (
                <BreadcrumbLink
                  className="flex cursor-pointer items-center gap-1"
                  onClick={() => navigate("")}
                >
                  <Home className="size-3.5" /> {bucketName}
                </BreadcrumbLink>
              )}
            </BreadcrumbItem>
            {crumbs.map((part, i) => {
              const target = crumbs.slice(0, i + 1).join("/") + "/";
              const isLast = i === crumbs.length - 1;
              return (
                <span key={target} className="contents">
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    {isLast ? (
                      <BreadcrumbPage>{part}</BreadcrumbPage>
                    ) : (
                      <BreadcrumbLink
                        className="cursor-pointer"
                        onClick={() => navigate(target)}
                      >
                        {part}
                      </BreadcrumbLink>
                    )}
                  </BreadcrumbItem>
                </span>
              );
            })}
          </BreadcrumbList>
        </Breadcrumb>
        <Badge variant="outline">read-only</Badge>
      </div>

      <ErrorBanner error={error} title="Cannot list objects" />

      {isLoading && !view ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : view ? (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Size</TableHead>
                  <TableHead>Last modified</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.commonPrefixes.map((p) => (
                  <TableRow
                    key={p}
                    className="cursor-pointer"
                    onClick={() => navigate(p)}
                  >
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-2">
                        <Folder className="size-4 text-muted-foreground" />
                        {p.slice(prefix.length).replace(/\/$/, "")}/
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">—</TableCell>
                    <TableCell className="text-muted-foreground">—</TableCell>
                    <TableCell />
                  </TableRow>
                ))}
                {view.objects.map((o) => (
                  <TableRow key={o.key}>
                    <TableCell>
                      <span className="flex items-center gap-2">
                        <File className="size-4 text-muted-foreground" />
                        {o.key.slice(prefix.length)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatBytes(o.size)}
                    </TableCell>
                    <TableCell>{formatDate(o.lastModified)}</TableCell>
                    <TableCell>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        title="Download"
                        render={
                          <a
                            href={`/api/s3/download?${new URLSearchParams({
                              bucketId,
                              bucketName,
                              key: o.key,
                            })}`}
                          />
                        }
                      >
                        <Download />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {view.commonPrefixes.length === 0 && view.objects.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      Empty prefix.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          {view.isTruncated && view.nextContinuationToken && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setToken(view.nextContinuationToken)}
            >
              Load more
            </Button>
          )}
        </>
      ) : null}
    </div>
  );
}
