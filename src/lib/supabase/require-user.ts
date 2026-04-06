import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createServerSupabase } from "./server";
import { demoActorId, isDemoNoAuthMode } from "./demo-mode";

type RequireUserResult =
  | {
      user: User;
      unauthorizedResponse: null;
    }
  | {
      user: null;
      unauthorizedResponse: NextResponse;
    };

export async function requireUser(): Promise<RequireUserResult> {
  if (isDemoNoAuthMode()) {
    return {
      user: { id: demoActorId() } as User,
      unauthorizedResponse: null,
    };
  }

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return {
      user: null,
      unauthorizedResponse: NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      ),
    };
  }

  return {
    user: data.user,
    unauthorizedResponse: null,
  };
}
