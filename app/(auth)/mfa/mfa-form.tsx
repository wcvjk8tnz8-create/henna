"use client";

import { useState } from "react";
import { useActionState } from "react";
import {
  beginEnrollment,
  verifySecondFactor,
  confirmEnrollment,
  initialMfaState,
  mfaVerifyAction,
} from "./actions";

export interface MfaFormProps {
  readonly enrolled: boolean;
  readonly pendingEnrollment: boolean;
  readonly recoveryCodesRemaining: number;
  readonly policy: string;
  readonly email: string;
  readonly hasPendingSession: boolean;
}

export function MfaForm(props: MfaFormProps) {
  /**
   * The verify form binds a Server Action directly rather than through a client
   * wrapper, so it still submits when JavaScript has not loaded. That matters
   * more here than anywhere else: this form is the last step of signing in, so
   * a button that silently does nothing locks the user out completely.
   */
  const [state, verifyAction, verifying] = useActionState(mfaVerifyAction, initialMfaState);
  const [enrollPending, setEnrollPending] = useState(false);
  const [useRecovery, setUseRecovery] = useState(false);
  const [enrollment, setEnrollment] = useState<{
    secret: string;
    uri: string;
    recoveryCodes: string[];
  } | null>(null);
  const [enrollError, setEnrollError] = useState<string | null>(null);
  // Whether to confirm a fresh enrollment or verify an existing one is a
  // server-side question, so the form tells the action which it is.
  const confirming = Boolean(enrollment);

  async function onEnroll() {
    setEnrollPending(true);
    try {
      const result = await beginEnrollment();
      if (result.ok && result.secret) {
        setEnrollment({
          secret: result.secret,
          uri: result.uri ?? "",
          recoveryCodes: result.recoveryCodes ?? [],
        });
      } else {
        setEnrollError(result.message);
      }
    } finally {
      setEnrollPending(false);
    }
  }

  return (
    <div className="mt-8">
      {!props.enrolled && !enrollment ? (
        <button
          type="button"
          onClick={onEnroll}
          disabled={enrollPending}
          className="w-full rounded-md bg-henna-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-henna-700 disabled:opacity-60"
        >
          {enrollPending ? "Preparing…" : "Set up an authenticator"}
        </button>
      ) : null}

      {enrollment ? (
        <div className="space-y-4">
          <div className="rounded-md border border-neutral-300 p-4 text-sm dark:border-neutral-700">
            <p className="font-medium">Secret key</p>
            <code className="mt-1 block break-all text-xs">{enrollment.secret}</code>
            {enrollment.uri ? (
              <p className="mt-2 text-xs text-neutral-500">
                Or add this URI to your app: <span className="break-all">{enrollment.uri}</span>
              </p>
            ) : null}
          </div>

          <div className="rounded-md border border-henna-400 bg-henna-50 p-4 text-sm dark:bg-henna-900/30">
            <p className="font-medium text-henna-900 dark:text-henna-100">Recovery codes</p>
            <p className="mt-1 text-xs text-henna-900/80 dark:text-henna-100/80">
              Save these now — they are shown only once.
            </p>
            <ul className="mt-2 grid grid-cols-2 gap-1 font-mono text-xs">
              {enrollment.recoveryCodes.map((code) => (
                <li key={code}>{code}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {props.enrolled || enrollment ? (
        <form action={verifyAction} className="mt-4 space-y-4">
          <input type="hidden" name="mode" value={confirming ? "confirm" : "verify"} />
          {useRecovery ? (
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Recovery code</span>
              <input
                name="recoveryCode"
                autoComplete="one-time-code"
                placeholder="abcd-1234-efgh"
                required
                className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 font-mono text-sm dark:border-neutral-700 dark:bg-neutral-900"
              />
            </label>
          ) : (
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Verification code</span>
              <input
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                pattern="\d{6}"
                required
                className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 font-mono text-sm tracking-widest dark:border-neutral-700 dark:bg-neutral-900"
              />
            </label>
          )}
          <button
            type="submit"
            disabled={verifying}
            className="w-full rounded-md bg-henna-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-henna-700 disabled:opacity-60"
          >
            {verifying ? "Checking…" : confirming ? "Confirm and continue" : "Verify"}
          </button>
        </form>
      ) : null}

      {props.enrolled ? (
        <button
          type="button"
          onClick={() => setUseRecovery((v) => !v)}
          className="mt-3 text-sm text-henna-700 underline dark:text-henna-400"
        >
          {useRecovery ? "Use an authenticator code" : "Use a recovery code instead"}
        </button>
      ) : null}

      {props.recoveryCodesRemaining <= 5 && props.enrolled ? (
        <p className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          You have {props.recoveryCodesRemaining} recovery codes left. Generate a new set from
          Settings → Security.
        </p>
      ) : null}

      {state.message || enrollError ? (
        <p role="alert" className="mt-4 text-sm text-red-700 dark:text-red-300">
          {state.message ?? enrollError}
        </p>
      ) : null}
    </div>
  );
}
