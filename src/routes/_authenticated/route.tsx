import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth", search: { message: null } });

    // Check if user must change password
    if (data.user.user_metadata?.['must_change_password']) {
      throw redirect({ to: "/change-password" as never });
    }

    return { user: data.user };
  },
  component: () => <Outlet />,
});
