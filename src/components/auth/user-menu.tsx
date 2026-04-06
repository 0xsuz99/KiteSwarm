"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

const isDemoMode =
  typeof window !== "undefined"
    ? process.env.NEXT_PUBLIC_DEMO_NO_AUTH === "1"
    : false;

export function UserMenu() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isDemoMode) return;

    let mounted = true;
    const supabase = createClient();

    const init = async () => {
      try {
        const { data } = await supabase.auth.getUser();
        if (mounted) {
          setUser(data.user ?? null);
        }
      } catch {
        // Silently handle auth errors
      }
    };
    void init();

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  async function onSignOut() {
    const supabase = createClient();
    setLoading(true);
    await supabase.auth.signOut();
    setLoading(false);
    router.replace("/sign-in");
    router.refresh();
  }

  if (isDemoMode) {
    return (
      <span className="text-xs text-indigo-600 bg-indigo-50 px-2 py-1 rounded-full border border-indigo-200">
        Demo Mode
      </span>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="flex items-center gap-3">
      <span className="hidden lg:block text-xs text-gray-500">{user.email}</span>
      <Button
        type="button"
        variant="outline"
        disabled={loading}
        onClick={onSignOut}
        className="border-gray-300 text-gray-700 hover:bg-gray-50 h-9 px-3"
      >
        {loading ? "Signing out..." : "Sign Out"}
      </Button>
    </div>
  );
}
