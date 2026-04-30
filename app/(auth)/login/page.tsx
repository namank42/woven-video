import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldDescription, FieldError } from "@/components/ui/field";
import { firstSearchParam, safeNextPath } from "@/lib/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

type LoginPageProps = {
  searchParams: Promise<{
    next?: string | string[];
    error?: string | string[];
    message?: string | string[];
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const next = safeNextPath(firstSearchParam(params.next));
  const error = firstSearchParam(params.error);
  const message = firstSearchParam(params.message);
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect(next);
  }

  return (
    <main className="flex min-h-screen flex-col bg-muted/30">
      <header className="py-3">
        <div className="mx-auto grid w-full max-w-6xl grid-cols-[1fr_auto_1fr] items-center gap-3 px-6">
          <Link
            href="/"
            className={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              "justify-self-start",
            )}
          >
            <ArrowLeftIcon data-icon="inline-start" />
            Back to site
          </Link>
          <Link href="/" className="flex items-center gap-2 justify-self-center">
            <Image
              src="/woven-logo.png"
              alt=""
              width={28}
              height={28}
              className="rounded-md"
              priority
            />
            <span className="font-heading text-base font-medium">Woven</span>
          </Link>
          <div aria-hidden="true" />
        </div>
      </header>
      <div className="flex flex-1 items-center justify-center px-6 py-10">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-xl">Sign in to Woven</CardTitle>
            <CardDescription>
              Use Woven locally with your own keys, or sign in to use
              Woven-hosted models.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              action="/auth/login/google"
              method="get"
              className="flex flex-col gap-4"
            >
              <input type="hidden" name="next" value={next} />
              {error ? (
                <Field data-invalid>
                  <FieldError>{error}</FieldError>
                </Field>
              ) : null}
              {message ? (
                <Field>
                  <FieldDescription>{message}</FieldDescription>
                </Field>
              ) : null}
              <Button type="submit" size="lg" className="h-12 w-full text-base">
                Continue with Google
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
