import { redirect } from "next/navigation";
import { HandwritingBoard } from "@/components/auth/handwriting-board";
import { LoginForm, type LoginState } from "@/components/auth/login-form";
import { verifyPassword } from "@/lib/auth/password";
import { currentUserId, startSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";

// A real scrypt hash of a value nobody holds. Verifying against it when the username does
// not exist costs the same as a real check, so the response does not reveal — by content or
// by timing — which half was wrong.
const ABSENT_USER_HASH =
	"scrypt$16384$8$1$YWJjZGVmZ2hpamtsbW5vcA==$Ym9ndXNib2d1c2JvZ3VzYm9ndXNib2d1c2JvZ3VzYm9ndXNib2d1c2JvZ3VzYm9ndXNib2d1c2Jv";

// No sign-up: accounts are created with `bun run user:add`. A registration flow is a whole
// surface — verification, rate limiting, abuse — for a product whose users are a class the
// client already knows by name.
import { ASSISTANT_INTRO, TEACHER_NAME } from "@/lib/brand";
export default async function LoginPage() {
	if (await currentUserId()) redirect("/");

	async function signIn(
		_state: LoginState,
		formData: FormData,
	): Promise<LoginState> {
		"use server";
		const username = String(formData.get("username") ?? "").trim();
		const password = String(formData.get("password") ?? "");

		const user = await prisma.user.findUnique({ where: { username } });
		const ok = verifyPassword(password, user?.passwordHash ?? ABSENT_USER_HASH);
		if (!user || !ok)
			return { error: "نام کاربری یا گذرواژه درست نیست.", username };

		await startSession(user.id);
		redirect("/");
	}

	return (
		// The board is a second column, never a banner stacked above the form: on a phone it
		// would push the only thing that matters below the fold.
		<div className="grid min-h-svh lg:grid-cols-[minmax(24rem,2fr)_3fr]">
			<main
				className="flex flex-col justify-center gap-8 px-6 py-12 sm:px-12"
				id="main"
			>
				<div className="mx-auto w-full max-w-sm space-y-8">
					<div className="space-y-2">
						<h1 className="font-bold text-3xl tracking-tight">
							{TEACHER_NAME}
						</h1>
						<p className="font-medium text-brand-red text-sm">
							{ASSISTANT_INTRO}
						</p>
						<p className="text-muted-foreground text-sm leading-6">
							سؤالت را بپرس و ببین استاد چطور حلش می‌کند — قدم‌به‌قدم، با همان روشی
							که سر کلاس گفته.
						</p>
					</div>

					<LoginForm signIn={signIn} />
				</div>
			</main>

			<HandwritingBoard />
		</div>
	);
}
