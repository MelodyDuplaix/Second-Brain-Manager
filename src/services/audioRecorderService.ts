export interface AudioRecordingResult {
	blob: Blob;
	durationMs: number;
	sampleRate: number;
}

export class AudioRecorderService {
	private mediaStream: MediaStream | null = null;
	private audioContext: AudioContext | null = null;
	private mediaRecorder: MediaRecorder | null = null;
	private recordedChunks: Blob[] = [];
	private startTime = 0;
	private isRecordingActive = false;
	private volumeCallback?: (volume: number) => void;
	private analyserNode: AnalyserNode | null = null;
	private animFrameId: number | null = null;

	public isRecording(): boolean {
		return this.isRecordingActive;
	}

	/**
	 * Démarre l'enregistrement audio à partir du microphone de l'utilisateur.
	 */
	public async startRecording(onVolumeChange?: (volume: number) => void): Promise<void> {
		if (this.isRecordingActive) {
			return;
		}

		if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
			throw new Error('L\'API microphone (getUserMedia) n\'est pas disponible sur cet appareil.');
		}

		try {
			this.mediaStream = await navigator.mediaDevices.getUserMedia({
				audio: {
					channelCount: 1,
					sampleRate: 16000,
					echoCancellation: true,
					noiseSuppression: true,
					autoGainControl: true
				}
			});

			this.recordedChunks = [];
			this.startTime = Date.now();
			this.volumeCallback = onVolumeChange;

			// Configuration de l'analyseur de volume pour l'animation UI
			const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
			if (AudioContextClass) {
				this.audioContext = new AudioContextClass();
				const sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
				this.analyserNode = this.audioContext.createAnalyser();
				this.analyserNode.fftSize = 256;
				sourceNode.connect(this.analyserNode);

				if (this.volumeCallback) {
					this.startVolumeMonitoring();
				}
			}

			// Utilisation de MediaRecorder avec fallback WAV
			const mimeType = this.getSupportedMimeType();
			const options = mimeType ? { mimeType } : undefined;

			this.mediaRecorder = new MediaRecorder(this.mediaStream, options);

			this.mediaRecorder.ondataavailable = (e) => {
				if (e.data && e.data.size > 0) {
					this.recordedChunks.push(e.data);
				}
			};

			this.mediaRecorder.start(250);
			this.isRecordingActive = true;
		} catch (err: unknown) {
			this.cleanup();
			const msg = err instanceof Error ? err.message : String(err);
			if (msg.includes('Permission denied') || msg.includes('NotAllowedError')) {
				throw new Error('Accès au microphone refusé. Veuillez autoriser l\'accès au micro dans les réglages.');
			}
			throw new Error(`Impossible de démarrer l'enregistrement audio : ${msg}`);
		}
	}

	/**
	 * Arrête l'enregistrement et retourne le Blob audio encodé au format WAV 16kHz mono.
	 */
	public async stopRecording(): Promise<AudioRecordingResult> {
		if (!this.isRecordingActive || !this.mediaRecorder) {
			throw new Error('Aucun enregistrement en cours.');
		}

		const durationMs = Date.now() - this.startTime;

		return new Promise<AudioRecordingResult>((resolve, reject) => {
			if (!this.mediaRecorder) {
				this.cleanup();
				reject(new Error('MediaRecorder introuvable.'));
				return;
			}

			this.mediaRecorder.onstop = async () => {
				try {
					const rawMimeType = this.mediaRecorder?.mimeType || 'audio/webm';
					const rawBlob = new Blob(this.recordedChunks, { type: rawMimeType });

					// Convertit le blob audio natif en WAV 16kHz mono (universellement supporté par Whisper et le Web)
					const wavBlob = await this.convertTo16kHzWav(rawBlob);

					this.cleanup();
					resolve({
						blob: wavBlob,
						durationMs,
						sampleRate: 16000
					});
				} catch (err) {
					this.cleanup();
					reject(err);
				}
			};

			this.mediaRecorder.stop();
		});
	}

	/**
	 * Annule l'enregistrement en cours sans générer de résultat.
	 */
	public cancelRecording(): void {
		if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
			try {
				this.mediaRecorder.stop();
			} catch {
				// Ignorer
			}
		}
		this.cleanup();
	}

	private startVolumeMonitoring(): void {
		if (!this.analyserNode || !this.volumeCallback) return;

		const buffer = new Uint8Array(this.analyserNode.frequencyBinCount);

		const monitor = () => {
			if (!this.isRecordingActive || !this.analyserNode) return;

			this.analyserNode.getByteFrequencyData(buffer);
			let sum = 0;
			for (let i = 0; i < buffer.length; i++) {
				sum += buffer[i];
			}
			const average = sum / buffer.length;
			const normalizedVolume = Math.min(1, average / 128);

			if (this.volumeCallback) {
				this.volumeCallback(normalizedVolume);
			}

			this.animFrameId = requestAnimationFrame(monitor);
		};

		this.animFrameId = requestAnimationFrame(monitor);
	}

	private cleanup(): void {
		this.isRecordingActive = false;

		if (this.animFrameId !== null) {
			cancelAnimationFrame(this.animFrameId);
			this.animFrameId = null;
		}

		if (this.mediaStream) {
			this.mediaStream.getTracks().forEach(t => t.stop());
			this.mediaStream = null;
		}

		if (this.audioContext && this.audioContext.state !== 'closed') {
			try {
				this.audioContext.close();
			} catch {
				// Ignorer
			}
			this.audioContext = null;
		}

		this.mediaRecorder = null;
		this.recordedChunks = [];
		this.analyserNode = null;
		this.volumeCallback = undefined;
	}

	private getSupportedMimeType(): string | undefined {
		const candidates = [
			'audio/webm;codecs=opus',
			'audio/webm',
			'audio/ogg;codecs=opus',
			'audio/mp4',
			'audio/wav'
		];
		for (const type of candidates) {
			if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) {
				return type;
			}
		}
		return undefined;
	}

	/**
	 * Convertit n'importe quel Blob audio supporté en WAV 16 000 Hz Mono (format Whisper PCM).
	 */
	public async convertTo16kHzWav(sourceBlob: Blob): Promise<Blob> {
		const arrayBuffer = await sourceBlob.arrayBuffer();
		const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

		if (!AudioContextClass) {
			return sourceBlob; // Fallback vers le blob brut si Web Audio indisponible
		}

		const tempCtx = new AudioContextClass();
		try {
			const decodedAudio = await tempCtx.decodeAudioData(arrayBuffer);
			const targetSampleRate = 16000;

			// Rééchantillonnage hors-ligne à 16kHz
			const offlineCtx = new OfflineAudioContext(
				1, // 1 canal (mono)
				Math.ceil(decodedAudio.duration * targetSampleRate),
				targetSampleRate
			);

			const bufferSource = offlineCtx.createBufferSource();
			bufferSource.buffer = decodedAudio;
			bufferSource.connect(offlineCtx.destination);
			bufferSource.start(0);

			const renderedBuffer = await offlineCtx.startRendering();
			const channelData = renderedBuffer.getChannelData(0);

			// Encode en WAV 16-bit PCM
			return this.encodePcmToWav(channelData, targetSampleRate);
		} catch {
			// Si le décodage échoue, renvoie le blob brut d'origine
			return sourceBlob;
		} finally {
			if (tempCtx.state !== 'closed') {
				tempCtx.close().catch(() => {});
			}
		}
	}

	/**
	 * Encode un tableau de samples Float32 en fichier WAV 16-bit PCM.
	 */
	public encodePcmToWav(samples: Float32Array, sampleRate = 16000): Blob {
		const buffer = new ArrayBuffer(44 + samples.length * 2);
		const view = new DataView(buffer);

		// 1. RIFF Identifier
		this.writeString(view, 0, 'RIFF');
		// RIFF chunk length
		view.setUint32(4, 36 + samples.length * 2, true);
		// RIFF Type
		this.writeString(view, 8, 'WAVE');

		// 2. format chunk
		this.writeString(view, 12, 'fmt ');
		view.setUint32(16, 16, true); // format chunk length
		view.setUint16(20, 1, true); // sample format (1 = PCM)
		view.setUint16(22, 1, true); // channel count (1 = mono)
		view.setUint32(24, sampleRate, true); // sample rate
		view.setUint32(28, sampleRate * 2, true); // byte rate (sampleRate * numChannels * bitsPerSample/8)
		view.setUint16(32, 2, true); // block align (numChannels * bitsPerSample/8)
		view.setUint16(34, 16, true); // bits per sample

		// 3. data chunk
		this.writeString(view, 36, 'data');
		view.setUint32(40, samples.length * 2, true);

		// Écriture des données audio Float32 -> 16-bit PCM
		let offset = 44;
		for (let i = 0; i < samples.length; i++, offset += 2) {
			const s = Math.max(-1, Math.min(1, samples[i]));
			view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
		}

		return new Blob([view], { type: 'audio/wav' });
	}

	private writeString(view: DataView, offset: number, string: string): void {
		for (let i = 0; i < string.length; i++) {
			view.setUint8(offset + i, string.charCodeAt(i));
		}
	}
}
