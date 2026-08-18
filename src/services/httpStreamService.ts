import { requestUrl } from 'obsidian';

export interface HttpStreamOptions {
	url: string;
	method?: 'POST' | 'GET';
	headers: Record<string, string>;
	body?: string;
	signal?: AbortSignal;
	onChunk: (chunk: string, fullText: string) => void;
}

/**
 * Service de streaming HTTP / SSE haute performance et résilient pour Obsidian.
 * - Utilise nativement Node.js `https` avec pool de connexions Keep-Alive pour réutiliser
 *   les sessions TLS et réduire la latence Time to First Token (TTFT) de ~150-300ms.
 * - Désactive l'algorithme de Nagle (`setNoDelay`) pour un streaming immédiat des chunks.
 * - Contourne les restrictions CORS Chromium (`app://obsidian.md`) sur Desktop.
 * - Utilise `requestUrl` comme fallback universel sur Mobile / Web.
 */
export class HttpStreamService {
	private static persistentHttpsAgent: unknown = null;
	private static persistentHttpAgent: unknown = null;

	private static getAgent(isHttps: boolean): unknown {
		try {
			const requireFn = (typeof window !== 'undefined' && (window as unknown as { require?: (m: string) => unknown }).require)
				? (window as unknown as { require: (m: string) => Record<string, unknown> }).require
				: require;

			if (isHttps) {
				if (!this.persistentHttpsAgent) {
					const https = requireFn('https') as { Agent: new (opts: Record<string, unknown>) => unknown };
					this.persistentHttpsAgent = new https.Agent({
						keepAlive: true,
						keepAliveMsecs: 60000,
						maxSockets: 10,
						maxFreeSockets: 5,
						timeout: 60000
					});
				}
				return this.persistentHttpsAgent;
			} else {
				if (!this.persistentHttpAgent) {
					const http = requireFn('http') as { Agent: new (opts: Record<string, unknown>) => unknown };
					this.persistentHttpAgent = new http.Agent({
						keepAlive: true,
						keepAliveMsecs: 60000,
						maxSockets: 10,
						maxFreeSockets: 5,
						timeout: 60000
					});
				}
				return this.persistentHttpAgent;
			}
		} catch {
			return undefined;
		}
	}

	public static async streamSSE(options: HttpStreamOptions): Promise<string> {
		const method = options.method || 'POST';
		const { url, headers, body, signal, onChunk } = options;

		// 1. Priorité 1 : Stream natif Node.js (Desktop / Electron) avec Keep-Alive -> 0 CORS, latence minimale
		const hasNodeRequire = typeof window !== 'undefined' && typeof (window as unknown as { require?: (mod: string) => unknown }).require === 'function';
		const hasGlobalRequire = typeof require === 'function';

		if (hasNodeRequire || hasGlobalRequire) {
			try {
				return await this.streamViaNode({ ...options, method });
			} catch (nodeErr: unknown) {
				const isHttpError = nodeErr && typeof nodeErr === 'object' && 'isHttpError' in nodeErr;
				// Si le serveur distant a retourné un code d'erreur HTTP explicite (ex: 400 validation, 401 auth), propager directement
				if (isHttpError || (nodeErr instanceof Error && nodeErr.message.includes('Erreur API'))) {
					throw nodeErr;
				}
				console.warn('[HttpStreamService] streamViaNode a échoué (module/réseau), repli sur fetch/requestUrl :', nodeErr);
			}
		}

		// 2. Priorité 2 : Essai standard via window.fetch (si CORS supporté par le serveur)
		try {
			const fetchRes = await window.fetch(url, {
				method,
				headers,
				body,
				signal
			});

			if (fetchRes.ok && fetchRes.body) {
				const reader = fetchRes.body.getReader();
				const decoder = new TextDecoder('utf-8');
				let fullText = '';
				let buffer = '';
				let isDone = false;

				while (!isDone) {
					const { done, value } = await reader.read();
					if (done) break;

					buffer += decoder.decode(value, { stream: true });
					const lines = buffer.split('\n');
					buffer = lines.pop() || '';

					for (const line of lines) {
						const trimmed = line.trim();
						if (trimmed.startsWith('data: ')) {
							const payload = trimmed.slice(6).trim();
							if (payload === '[DONE]') {
								isDone = true;
								break;
							}
							if (payload) {
								try {
									const parsed = JSON.parse(payload) as {
										choices?: Array<{ delta?: { content?: string }; text?: string }>;
									};
									const delta = parsed.choices?.[0]?.delta?.content ?? parsed.choices?.[0]?.text;
									if (delta) {
										fullText += delta;
										onChunk(delta, fullText);
									}
								} catch {
									// fragment JSON incomplet
								}
							}
						}
					}
				}

				if (fullText.length > 0) {
					return fullText;
				}
			}
		} catch (fetchErr: unknown) {
			console.warn('[HttpStreamService] fetch a rencontré une restriction CORS ou réseau, repli sur requestUrl :', fetchErr);
		}

		// 3. Fallback universel : requestUrl d'Obsidian (contourne CORS à 100% sur mobile et desktop)
		return await this.fallbackViaRequestUrl({ ...options, method });
	}

	private static streamViaNode(options: HttpStreamOptions & { method: string }): Promise<string> {
		return new Promise((resolve, reject) => {
			const { url, method, headers, body, signal, onChunk } = options;
			const parsedUrl = new URL(url);

			const isHttps = parsedUrl.protocol === 'https:';
			const requireFn = (typeof window !== 'undefined' && (window as unknown as { require?: (m: string) => unknown }).require)
				? (window as unknown as { require: (m: string) => Record<string, unknown> }).require
				: require;

			const httpModule = requireFn(isHttps ? 'https' : 'http') as {
				request: (opts: Record<string, unknown>, cb: (res: {
					statusCode: number;
					on: (event: string, cb: (data?: unknown) => void) => void;
				}) => void) => {
					on: (event: string, cb: (data?: unknown) => void) => void;
					write: (chunk: string) => void;
					end: () => void;
					destroy: () => void;
				};
			};

			const reqHeaders = {
				...headers,
				'Content-Length': body ? String(Buffer.byteLength(body, 'utf-8')) : '0'
			};

			const agent = this.getAgent(isHttps);
			const reqOptions = {
				hostname: parsedUrl.hostname,
				port: parsedUrl.port ? Number(parsedUrl.port) : (isHttps ? 443 : 80),
				path: `${parsedUrl.pathname}${parsedUrl.search}`,
				method,
				headers: reqHeaders,
				...(agent ? { agent } : {})
			};

			const req = httpModule.request(reqOptions, (res) => {
				if (res.statusCode < 200 || res.statusCode >= 300) {
					let errorBody = '';
					res.on('data', (d: unknown) => {
						errorBody += String(d);
					});
					res.on('end', () => {
						let detail = errorBody;
						try {
							const parsed = JSON.parse(errorBody) as {
								error?: { message?: string; description?: string };
								message?: string;
							};
							detail = parsed.error?.message || parsed.error?.description || parsed.message || errorBody;
						} catch {
							// garder errorBody brut
						}
						const err = new Error(`Erreur API (${res.statusCode}) : ${detail}`);
						Object.assign(err, { isHttpError: true, statusCode: res.statusCode });
						reject(err);
					});
					return;
				}

				let fullText = '';
				let buffer = '';

				res.on('data', (chunk: unknown) => {
					buffer += String(chunk);
					const lines = buffer.split('\n');
					buffer = lines.pop() || '';

					for (const line of lines) {
						const trimmed = line.trim();
						if (trimmed.startsWith('data: ')) {
							const payload = trimmed.slice(6).trim();
							if (payload === '[DONE]') {
								break;
							}
							if (payload) {
								try {
									const parsed = JSON.parse(payload) as {
										choices?: Array<{ delta?: { content?: string }; text?: string }>;
									};
									const delta = parsed.choices?.[0]?.delta?.content ?? parsed.choices?.[0]?.text;
									if (delta) {
										fullText += delta;
										onChunk(delta, fullText);
									}
								} catch {
									// fragment incomplet
								}
							}
						}
					}
				});

				res.on('end', () => {
					resolve(fullText);
				});

				res.on('error', (err: unknown) => {
					reject(err);
				});
			});

			// Optimisation de bas niveau sur le socket : désactiver Nagle et maintenir le Keep-Alive
			req.on('socket', (socket: unknown) => {
				if (socket && typeof socket === 'object') {
					const s = socket as { setNoDelay?: (noDelay: boolean) => void; setKeepAlive?: (enable: boolean, initialDelay: number) => void };
					if (typeof s.setNoDelay === 'function') s.setNoDelay(true);
					if (typeof s.setKeepAlive === 'function') s.setKeepAlive(true, 60000);
				}
			});

			req.on('error', (err: unknown) => {
				reject(err);
			});

			if (signal) {
				signal.addEventListener('abort', () => {
					req.destroy();
					reject(new Error('Requête annulée par l\'utilisateur.'));
				});
			}

			if (body) {
				req.write(body);
			}
			req.end();
		});
	}

	private static async fallbackViaRequestUrl(options: HttpStreamOptions & { method: string }): Promise<string> {
		const { url, method, headers, body, onChunk } = options;

		let payloadBody = body;
		if (body) {
			try {
				const parsed = JSON.parse(body) as Record<string, unknown>;
				parsed.stream = false;
				payloadBody = JSON.stringify(parsed);
			} catch {
				// garder le body intact
			}
		}

		const response = await requestUrl({
			url,
			method,
			headers,
			body: payloadBody,
			throw: false
		});

		if (response.status < 200 || response.status >= 300) {
			throw new Error(`Erreur API (${response.status}) : ${response.text}`);
		}

		let extractedText = '';
		if (response.json) {
			const json = response.json as {
				choices?: Array<{ message?: { content?: string }; text?: string }>;
			};
			extractedText = json.choices?.[0]?.message?.content ?? json.choices?.[0]?.text ?? response.text;
		} else {
			const lines = response.text.split('\n');
			for (const line of lines) {
				const trimmed = line.trim();
				if (trimmed.startsWith('data: ')) {
					const payload = trimmed.slice(6).trim();
					if (payload && payload !== '[DONE]') {
						try {
							const parsed = JSON.parse(payload) as {
								choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }>;
							};
							const delta = parsed.choices?.[0]?.delta?.content ?? parsed.choices?.[0]?.message?.content;
							if (delta) extractedText += delta;
						} catch {
							// fragment
						}
					}
				}
			}
		}

		if (!extractedText) {
			extractedText = response.text;
		}

		onChunk(extractedText, extractedText);
		return extractedText;
	}
}
