"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "lucide-react";

type ActivityStatus = "success" | "failed" | "pending" | "executing";

type ActivityEntry = {
  id: string;
  created_at: string;
  action_type: string;
  description: string | null;
  status: ActivityStatus;
  tx_hash: string | null;
  agent: {
    id: string;
    name: string;
  } | null;
};

const statusStyles: Record<ActivityStatus, string> = {
  success: "bg-emerald-500/20 text-emerald-400 border-0",
  failed: "bg-red-500/20 text-red-400 border-0",
  pending: "bg-amber-500/20 text-amber-400 border-0",
  executing: "bg-indigo-500/20 text-indigo-400 border-0",
};

function truncateHash(hash: string): string {
  return `${hash.slice(0, 10)}...${hash.slice(-6)}`;
}

export default function ActivityPage() {
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const empty = useMemo(
    () => !loading && !error && activity.length === 0,
    [activity.length, error, loading]
  );

  useEffect(() => {
    const loadFirstPage = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await fetch("/api/activity?page=1&pageSize=25", {
          credentials: "include",
          cache: "no-store",
        });
        const payload = await response.json();
        if (!response.ok) {
          setError(payload.error ?? "Failed to load activity");
          return;
        }
        setActivity((payload.activity ?? []) as ActivityEntry[]);
        setPage(1);
        setHasMore(Boolean(payload.pagination?.hasMore));
      } catch {
        setError("Failed to load activity");
      } finally {
        setLoading(false);
      }
    };

    void loadFirstPage();
  }, []);

  async function loadMore() {
    try {
      setLoadingMore(true);
      setError(null);
      const nextPage = page + 1;
      const response = await fetch(
        `/api/activity?page=${nextPage}&pageSize=25`,
        {
          credentials: "include",
          cache: "no-store",
        }
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to load more activity");
      }

      setActivity((current) => [
        ...current,
        ...((payload.activity ?? []) as ActivityEntry[]),
      ]);
      setPage(nextPage);
      setHasMore(Boolean(payload.pagination?.hasMore));
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Failed to load more activity"
      );
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Activity Feed</h1>
        <p className="text-slate-400 text-sm mt-1">
          Global activity log across all agents
        </p>
      </div>

      {loading ? <p className="text-slate-400 text-sm">Loading activity...</p> : null}
      {error ? <p className="text-red-400 text-sm">{error}</p> : null}
      {empty ? (
        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="pt-6 text-sm text-slate-400">
            No executions yet.
          </CardContent>
        </Card>
      ) : null}

      <Card className="bg-slate-900 border-slate-800">
        <CardHeader>
          <CardTitle className="text-white">All Transactions</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="border-slate-800 hover:bg-transparent">
                <TableHead className="text-slate-400">Time</TableHead>
                <TableHead className="text-slate-400">Agent</TableHead>
                <TableHead className="text-slate-400">Action Type</TableHead>
                <TableHead className="text-slate-400">Description</TableHead>
                <TableHead className="text-slate-400">Status</TableHead>
                <TableHead className="text-slate-400">Tx Hash</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activity.map((entry) => (
                <TableRow key={entry.id} className="border-slate-800">
                  <TableCell className="text-slate-300 text-sm whitespace-nowrap">
                    {new Date(entry.created_at).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-slate-300 text-sm">
                    {entry.agent?.name ?? "Unknown Agent"}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className="border-indigo-500/30 text-indigo-400"
                    >
                      {entry.action_type}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-slate-300 text-sm max-w-[250px] truncate">
                    {entry.description ?? "-"}
                  </TableCell>
                  <TableCell>
                    <Badge className={statusStyles[entry.status]}>{entry.status}</Badge>
                  </TableCell>
                  <TableCell>
                    {entry.tx_hash ? (
                      <a
                        href={`https://testnet.kitescan.ai/tx/${entry.tx_hash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-indigo-400 hover:text-indigo-300 text-sm flex items-center gap-1"
                      >
                        {truncateHash(entry.tx_hash)}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      <span className="text-slate-500 text-sm">-</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {hasMore ? (
        <div className="flex justify-center">
          <Button
            variant="outline"
            className="border-gray-300 text-gray-700 hover:bg-gray-50"
            disabled={loadingMore}
            onClick={() => {
              void loadMore();
            }}
          >
            {loadingMore ? "Loading..." : "Load More"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
