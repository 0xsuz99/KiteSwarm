import { Loader2, Zap } from "lucide-react";

export default function RootLoading() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-white via-indigo-50/40 to-white flex items-center justify-center px-6">
      <div className="w-full max-w-sm rounded-2xl border border-indigo-100 bg-white/95 shadow-xl shadow-indigo-100 p-6">
        <div className="flex items-center gap-3">
          <div className="relative h-11 w-11 rounded-xl bg-indigo-600 flex items-center justify-center">
            <Zap className="h-5 w-5 text-white" />
            <span className="absolute inset-0 rounded-xl border border-indigo-300 animate-ping opacity-50" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">Loading KiteSwarm</p>
            <p className="text-xs text-gray-500">Preparing live portfolio intelligence</p>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-2 text-xs text-gray-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-500" />
          Syncing dashboard state and on-chain data...
        </div>
      </div>
    </div>
  );
}

