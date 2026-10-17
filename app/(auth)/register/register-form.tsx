"use client";

import { useActionState } from "react";
import { initialRegisterState, registerAction } from "./actions";

export interface RegisterFormProps {
  readonly passwordMinLength: number;
  readonly requireComplexity: boolean;
  /** True only when no account exists yet, so the hint can name the ADMIN setting. */
  readonly isBootstrap: boolean;
}

export function RegisterForm(props: RegisterFormProps) {
  /**
   * The form posts straight to the Server Action.
   *
   * It previously went through a client wrapper (`onSubmit` → `startTransition`
   * → `await action()`), which meant the button did nothing at all whenever
   * JavaScript had not loaded or hydration had not finished. Binding the Server
   * Action directly means the browser can submit the form natively, with no JS,
   * and `useActionState` layers the error message back on once it has.
   */
  const [state, formAction, pending] = useActionState(registerAction, initialRegisterState);

  return (
    <form action={formAction} className="mt-8 space-y-4">
      <Field label="Email" name="email" type="email" autoComplete="username" required />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={props.passwordMinLength}
        description={
          props.requireComplexity
            ? `At least ${props.passwordMinLength} characters, with a letter, a number and a symbol.`
            : `At least ${props.passwordMinLength} characters.`
        }
      />
      <Field
        label="Confirm password"
        name="confirm"
        type="password"
        autoComplete="new-password"
        required
        minLength={props.passwordMinLength}
      />

      {props.isBootstrap ? (
        <p className="rounded-md border border-henna-400 bg-henna-50 px-3 py-2 text-sm text-henna-900 dark:bg-henna-950 dark:text-henna-100">
          This is the first account, so it becomes the administrator. Use the address in your{" "}
          <code>ADMIN</code> setting.
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-henna-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-henna-700 disabled:opacity-60"
      >
        {pending ? "Creating…" : "Create account"}
      </button>

      {state.message ? (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

function Field(props: {
  readonly label: string;
  readonly name: string;
  readonly type?: string;
  readonly description?: string;
  readonly autoComplete?: string;
  readonly required?: boolean;
  readonly minLength?: number;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{props.label}</span>
      <input
        name={props.name}
        type={props.type ?? "text"}
        autoComplete={props.autoComplete}
        required={props.required}
        minLength={props.minLength}
        className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-henna-600 dark:border-neutral-700 dark:bg-neutral-900"
      />
      {props.description ? (
        <span className="mt-1 block text-xs text-neutral-500">{props.description}</span>
      ) : null}
    </label>
  );
}
