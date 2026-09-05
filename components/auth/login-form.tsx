"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

export type LoginState = { error: string; username: string } | null;

function SubmitButton() {
	// Enabled until the request actually starts, then a spinner — a button disabled while
	// idle looks broken, and one that stays idle-looking during a request invites a second
	// submit.
	const { pending } = useFormStatus();
	return (
		<Button className="w-full" disabled={pending} type="submit">
			{pending ? (
				<>
					<Spinner /> در حال ورود…
				</>
			) : (
				"ورود"
			)}
		</Button>
	);
}

export function LoginForm({
	signIn,
}: {
	signIn: (state: LoginState, formData: FormData) => Promise<LoginState>;
}) {
	const [state, action] = useActionState(signIn, null);

	return (
		<form action={action} className="space-y-3">
			<Input
				autoComplete="username"
				// The action resets an uncontrolled form, so a failed attempt would otherwise
				// make the student retype a username that was never the problem.
				defaultValue={state?.username}
				dir="ltr"
				name="username"
				placeholder="نام کاربری…"
				required
				spellCheck={false}
				// The error is not attributed to one field: the server deliberately cannot tell
				// which of the two was wrong.
				aria-invalid={state ? true : undefined}
			/>
			<Input
				autoComplete="current-password"
				dir="ltr"
				name="password"
				placeholder="گذرواژه…"
				required
				spellCheck={false}
				type="password"
				aria-invalid={state ? true : undefined}
			/>

			<div aria-live="polite">
				{state && (
					<p className="text-destructive text-sm" role="alert">
						{state.error}
					</p>
				)}
			</div>

			<SubmitButton />
		</form>
	);
}
