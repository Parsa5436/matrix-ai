/**
 * A refusal the student can read, from any route the chat UI calls.
 *
 * Plain text, not JSON, and that is the whole point: `useChat` throws
 * `new Error(await response.text())` on any non-2xx and the composer renders `error.message`,
 * so a JSON body reaches the screen with its braces showing. `answer-audio` reads the speech
 * route the same way.
 */
export const refuse = (message: string, status: number) =>
	new Response(message, {
		status,
		headers: { "content-type": "text/plain; charset=utf-8" },
	});
