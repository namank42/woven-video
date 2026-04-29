"use client";

import { useTransition } from "react";
import { LogOutIcon } from "lucide-react";

import { signOut } from "@/app/account/actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function AccountUserMenu({ email }: { email: string }) {
  const [pending, startTransition] = useTransition();
  const initial = (email || "?").slice(0, 1).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Open account menu"
        className="flex size-8 items-center justify-center rounded-full bg-foreground text-sm font-medium text-background outline-none ring-offset-background transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 data-popup-open:opacity-90"
      >
        {initial}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="min-w-56">
        <div className="flex flex-col gap-0.5 px-2 py-1.5">
          <span className="text-xs text-muted-foreground">Signed in as</span>
          <span className="truncate text-sm font-medium text-foreground">
            {email}
          </span>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          disabled={pending}
          onClick={() => startTransition(() => signOut())}
        >
          <LogOutIcon />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
