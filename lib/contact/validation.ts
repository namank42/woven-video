// Pure, dependency-free validation for the contact form. Kept separate from the
// Server Action so it can be reasoned about (and unit-tested) in isolation.
// Mirrors the feedback table CHECK constraints (message 1..10000, name <=200,
// email <=320). Email format is a deliberately loose sanity check.

export type ContactInput = {
  name: string;
  email: string;
  message: string;
};

export type ContactValidationResult =
  | { ok: true; data: { name: string | null; email: string; message: string } }
  | { ok: false; errors: Record<string, string[]> };

export const NAME_MAX = 200;
export const EMAIL_MAX = 320;
export const MESSAGE_MAX = 10000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateContact(input: ContactInput): ContactValidationResult {
  const name = input.name.trim();
  const email = input.email.trim();
  const message = input.message.trim();

  const errors: Record<string, string[]> = {};

  if (!email) {
    errors.email = ["Please enter your email."];
  } else if (email.length > EMAIL_MAX) {
    errors.email = ["That email is too long."];
  } else if (!EMAIL_RE.test(email)) {
    errors.email = ["Please enter a valid email address."];
  }

  if (!message) {
    errors.message = ["Please enter a message."];
  } else if (message.length > MESSAGE_MAX) {
    errors.message = [`Message must be ${MESSAGE_MAX} characters or fewer.`];
  }

  if (name.length > NAME_MAX) {
    errors.name = [`Name must be ${NAME_MAX} characters or fewer.`];
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, data: { name: name || null, email, message } };
}
