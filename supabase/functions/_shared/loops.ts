// Fires a Loops event from edge functions. No-ops when LOOPS_API_KEY is unset
// (local/preview), mirroring the DB signup trigger's "missing key => no-op" behavior.
// Loops automations turn these events into emails (configured in the Loops dashboard).
export async function sendLoopsEvent(args: {
  email: string;
  userId?: string | null;
  eventName: string;
  properties?: Record<string, unknown>;
}): Promise<void> {
  const key = Deno.env.get("LOOPS_API_KEY");
  if (!key || !args.email) {
    return;
  }

  try {
    await fetch("https://app.loops.so/api/v1/events/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        email: args.email,
        userId: args.userId ?? undefined,
        eventName: args.eventName,
        ...(args.properties ?? {}),
      }),
    });
  } catch (error) {
    console.error(`loops event "${args.eventName}" failed:`, error);
  }
}
