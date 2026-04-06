import { Loader2, Zap } from "lucide-react";

export default function DashboardLoading() {
  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4">
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-indigo-600 flex items-center justify-center">
            <Zap className="h-5 w-5 text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">Loading dashboard</p>
            <p className="text-xs text-gray-500">Streaming agent metrics and activity</p>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-2 text-xs text-gray-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-500" />
          This usually takes a second...
        </div>
      </div>
    </div>
  );
}

