export class ProtocolError extends Error {
	constructor(
		readonly code: number,
		message: string,
	) {
		super(message);
	}
}
