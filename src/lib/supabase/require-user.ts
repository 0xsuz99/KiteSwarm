import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createServerSupabase } from "./server";

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
