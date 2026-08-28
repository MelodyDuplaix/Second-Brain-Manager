import SecondBrainPlugin from '../main';
import { AudioRecorderService } from './audioRecorderService';

export interface SpeechToTextResult {
	text: string;
	language?: string;
	durationMs?: number;
}

export interface SpeechProgressUpdate {
	stage: 'loading' | 'progress' | 'transcribing' | 'success' | 'error';
	percent?: number;
	file?: string;
	message?: string;
}

export class SpeechToTextService {
	private plugin: SecondBrainPlugin;
	private static workerInstance: Worker | null = null;

	constructor(plugin: SecondBrainPlugin) {
		this.plugin = plugin;
	}

	/**
	 * Vérifie si la Web Speech API native est disponible dans l'environnement actuel.
	 */
	public static isWebSpeechSupported(): boolean {
		if (typeof window === 'undefined') return false;
		const win = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
		return typeof win.SpeechRecognition !== 'undefined' || typeof win.webkitSpeechRecognition !== 'undefined';
	}

	/**
	 * Convertit le choix de configuration en identifiant de modèle HuggingFace ONNX.
	 */
	public getModelId(): string {
		const setting = this.plugin.settings.sttModel || 'whisper-base';
		switch (setting) {
			case 'whisper-tiny':
				return 'onnx-community/whisper-tiny';
			case 'whisper-small':
				return 'onnx-community/whisper-small';
			case 'whisper-base':
			default:
				return 'onnx-community/whisper-base';
		}
	}

	/**
	 * Initialise ou récupère le Web Worker Whisper WebAssembly isolé.
	 * Masque `process` avant le dynamic import de `@huggingface/transformers`
	 * pour forcer l'environnement Browser/WebAssembly sans dépendance à onnxruntime-node.
	 */
	private static getWhisperWorker(): Promise<Worker> {
		return new Promise((resolve, reject) => {
			if (this.workerInstance) {
				resolve(this.workerInstance);
				return;
			}

			try {
				const workerCode = `
					let transcriber = null;
					let currentModelId = null;

					self.onmessage = async (e) => {
						const { type, audio, language, modelId } = e.data;
						const targetModel = modelId || 'onnx-community/whisper-base';

						if (type === 'transcribe') {
							try {
								if (!transcriber || currentModelId !== targetModel) {
									self.postMessage({ type: 'status', status: 'loading', model: targetModel });

									// Masquage impératif de process AVANT l'import pour forcer le runtime onnxruntime-web
									try {
										delete self.process;
									} catch {
										self.process = undefined;
									}

									const { pipeline, env } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.3');

									env.allowLocalModels = false;
									env.useBrowserCache = true;
									if (env.backends && env.backends.onnx && env.backends.onnx.wasm) {
										env.backends.onnx.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.3/dist/';
										env.backends.onnx.wasm.numThreads = 1;
										env.backends.onnx.wasm.proxy = false;
									}

									transcriber = await pipeline('automatic-speech-recognition', targetModel, {
										device: 'wasm',
										dtype: 'fp32',
										progress_callback: (info) => {
											if (info && info.status === 'progress' && typeof info.progress === 'number') {
												self.postMessage({
													type: 'progress',
													progress: Math.round(info.progress),
													file: info.file || targetModel
												});
											}
										}
									});
									currentModelId = targetModel;
								}

								self.postMessage({ type: 'status', status: 'transcribing' });

								const langOption = language === 'fr' ? 'french' : language === 'en' ? 'english' : (language === 'auto' ? null : language);

								const options = {
									task: 'transcribe',
									...(langOption ? {
										language: langOption,
										generate_kwargs: {
											language: langOption,
											task: 'transcribe'
										}
									} : {})
								};

								const output = await transcriber(audio, options);

								const text = typeof output === 'object' && output !== null && 'text' in output
									? output.text.trim()
									: String(output).trim();

								self.postMessage({ type: 'success', text });
							} catch (err) {
								self.postMessage({
									type: 'error',
									error: err && err.message ? err.message : String(err)
								});
							}
						}
					};
				`;

				const blob = new Blob([workerCode], { type: 'application/javascript' });
				const workerUrl = URL.createObjectURL(blob);
				const worker = new Worker(workerUrl, { type: 'module' });

				this.workerInstance = worker;
				resolve(worker);
			} catch (err) {
				reject(new Error(`Impossible de démarrer le worker Whisper : ${err instanceof Error ? err.message : String(err)}`));
			}
		});
	}

	/**
	 * Transcrit les données audio PCM Float32Array 16kHz via le moteur sélectionné
	 * (Whisper WASM local avec modèle choisi ou Web Speech API).
	 */
	public async transcribeAudio(
		audioData: Float32Array | Blob,
		onProgress?: (update: SpeechProgressUpdate) => void
	): Promise<SpeechToTextResult> {
		let pcmSamples: Float32Array;

		if (audioData instanceof Blob) {
			pcmSamples = await this.convertBlobTo16kHzFloat32(audioData);
		} else {
			pcmSamples = AudioRecorderService.normalizeAndTrimSamples(audioData);
		}

		if (!pcmSamples || pcmSamples.length === 0) {
			return { text: '' };
		}

		const language = this.plugin.settings.sttLanguage || 'fr';
		const modelId = this.getModelId();
		const startTime = Date.now();
		const worker = await SpeechToTextService.getWhisperWorker();

		return new Promise<SpeechToTextResult>((resolve, reject) => {
			const handleMessage = (event: MessageEvent) => {
				const data = event.data;
				if (!data || typeof data !== 'object') return;

				if (data.type === 'status' && data.status === 'loading') {
					const modelName = modelId.split('/').pop() || 'whisper';
					onProgress?.({
						stage: 'loading',
						message: `Initialisation ${modelName}...`
					});
				} else if (data.type === 'status' && data.status === 'transcribing') {
					onProgress?.({
						stage: 'transcribing',
						message: 'Transcription en cours...'
					});
				} else if (data.type === 'progress') {
					onProgress?.({
						stage: 'progress',
						percent: data.progress,
						file: data.file,
						message: `${data.progress}%`
					});
				} else if (data.type === 'success') {
					cleanup();
					onProgress?.({
						stage: 'success',
						message: 'Terminé'
					});
					resolve({
						text: data.text || '',
						language,
						durationMs: Date.now() - startTime
					});
				} else if (data.type === 'error') {
					cleanup();
					onProgress?.({
						stage: 'error',
						message: data.error || 'Erreur'
					});
					reject(new Error(data.error || 'Erreur inconnue lors de la transcription locale.'));
				}
			};

			const handleError = (err: ErrorEvent) => {
				cleanup();
				onProgress?.({
					stage: 'error',
					message: err.message || 'Échec du worker'
				});
				reject(new Error(`Erreur Worker Whisper : ${err.message || 'Échec du worker'}`));
			};

			const cleanup = () => {
				worker.removeEventListener('message', handleMessage);
				worker.removeEventListener('error', handleError);
			};

			worker.addEventListener('message', handleMessage);
			worker.addEventListener('error', handleError);

			// Envoi des échantillons PCM au Web Worker
			worker.postMessage({
				type: 'transcribe',
				audio: pcmSamples,
				language,
				modelId
			});
		});
	}

	/**
	 * Convertit un Blob audio quelconque en Float32Array PCM 16 000 Hz Mono normalisé.
	 */
	public async convertBlobTo16kHzFloat32(sourceBlob: Blob): Promise<Float32Array> {
		const arrayBuffer = await sourceBlob.arrayBuffer();
		const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

		if (!AudioContextClass) {
			throw new Error('Web Audio API indisponible sur cet appareil.');
		}

		const tempCtx = new AudioContextClass();
		try {
			const decodedAudio = await tempCtx.decodeAudioData(arrayBuffer);
			const targetSampleRate = 16000;

			const offlineCtx = new OfflineAudioContext(
				1,
				Math.ceil(decodedAudio.duration * targetSampleRate),
				targetSampleRate
			);

			const bufferSource = offlineCtx.createBufferSource();
			bufferSource.buffer = decodedAudio;
			bufferSource.connect(offlineCtx.destination);
			bufferSource.start(0);

			const renderedBuffer = await offlineCtx.startRendering();
			const channelData = renderedBuffer.getChannelData(0);

			// Normalisation et découpe de silence de haute précision
			return AudioRecorderService.normalizeAndTrimSamples(channelData, targetSampleRate);
		} finally {
			if (tempCtx.state !== 'closed') {
				tempCtx.close().catch(() => {});
			}
		}
	}
}
