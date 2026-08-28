import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SpeechToTextService } from '../../src/services/speechToTextService';
import { AudioRecorderService } from '../../src/services/audioRecorderService';

describe('SpeechToTextService & AudioRecorderService (100% Local Whisper WASM)', () => {
	let mockPlugin: any;

	beforeEach(() => {
		mockPlugin = {
			settings: {
				sttEngine: 'whisper-local',
				sttModel: 'whisper-base',
				sttLanguage: 'fr',
				sttAutoSend: false
			}
		};
	});

	it('should encode Float32 PCM samples into a valid WAV blob with 16kHz mono header', () => {
		const recorder = new AudioRecorderService();
		const sampleRate = 16000;
		const samples = new Float32Array([0, 0.5, -0.5, 0.8, -0.8, 1.0, -1.0]);

		const wavBlob = recorder.encodePcmToWav(samples, sampleRate);
		expect(wavBlob).toBeDefined();
		expect(wavBlob.type).toBe('audio/wav');
		expect(wavBlob.size).toBe(44 + samples.length * 2);
	});

	it('should normalize peak amplitude and trim silence in PCM samples', () => {
		const quietSamples = new Float32Array(3200); // 200ms at 16kHz
		quietSamples.fill(0); // silence
		// Add some quiet speech in the middle
		for (let i = 800; i < 2400; i++) {
			quietSamples[i] = 0.2 * Math.sin(i);
		}

		const processed = AudioRecorderService.normalizeAndTrimSamples(quietSamples, 16000);
		expect(processed).toBeDefined();
		expect(processed.length).toBeGreaterThan(0);

		// Verify peak is normalized towards 0.95
		let maxPeak = 0;
		for (let i = 0; i < processed.length; i++) {
			const abs = Math.abs(processed[i]);
			if (abs > maxPeak) maxPeak = abs;
		}
		expect(maxPeak).toBeCloseTo(0.95, 1);
	});

	it('should map sttModel setting to proper HuggingFace ONNX model ID', () => {
		const service = new SpeechToTextService(mockPlugin);
		expect(service.getModelId()).toBe('onnx-community/whisper-base');

		mockPlugin.settings.sttModel = 'whisper-tiny';
		expect(service.getModelId()).toBe('onnx-community/whisper-tiny');

		mockPlugin.settings.sttModel = 'whisper-small';
		expect(service.getModelId()).toBe('onnx-community/whisper-small');
	});

	it('should transcribe Float32 audio samples via Whisper Web Worker and notify progress', async () => {
		const service = new SpeechToTextService(mockPlugin);
		const samples = new Float32Array([0.1, 0.2, -0.1, -0.2]);

		const mockWorker = {
			postMessage: vi.fn((_data: any) => {
				setTimeout(() => {
					mockWorker.listeners['message']?.({
						data: { type: 'status', status: 'loading' }
					});
					mockWorker.listeners['message']?.({
						data: { type: 'progress', progress: 50, file: 'whisper-base' }
					});
					mockWorker.listeners['message']?.({
						data: { type: 'success', text: 'Bonjour, ceci est un test Whisper local.' }
					});
				}, 10);
			}),
			listeners: {} as Record<string, any>,
			addEventListener: (event: string, cb: any) => {
				mockWorker.listeners[event] = cb;
			},
			removeEventListener: (event: string, _cb: any) => {
				delete mockWorker.listeners[event];
			}
		};

		vi.spyOn(SpeechToTextService as any, 'getWhisperWorker').mockResolvedValue(mockWorker as any);

		const progressUpdates: any[] = [];
		const result = await service.transcribeAudio(samples, (update) => {
			progressUpdates.push(update);
		});

		expect(mockWorker.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'transcribe',
				audio: expect.any(Float32Array),
				language: 'fr',
				modelId: 'onnx-community/whisper-base'
			})
		);
		expect(result.text).toBe('Bonjour, ceci est un test Whisper local.');
		expect(result.language).toBe('fr');
		expect(progressUpdates.length).toBeGreaterThan(0);
		expect(progressUpdates.some(p => p.stage === 'loading')).toBe(true);
	});

	it('should handle worker errors gracefully', async () => {
		const service = new SpeechToTextService(mockPlugin);
		const samples = new Float32Array([0.1, 0.2]);

		const mockWorker = {
			postMessage: vi.fn(() => {
				setTimeout(() => {
					mockWorker.listeners['message']?.({
						data: { type: 'error', error: 'Modèle introuvable' }
					});
				}, 10);
			}),
			listeners: {} as Record<string, any>,
			addEventListener: (event: string, cb: any) => {
				mockWorker.listeners[event] = cb;
			},
			removeEventListener: (event: string, _cb: any) => {
				delete mockWorker.listeners[event];
			}
		};

		vi.spyOn(SpeechToTextService as any, 'getWhisperWorker').mockResolvedValue(mockWorker as any);

		await expect(service.transcribeAudio(samples)).rejects.toThrow('Modèle introuvable');
	});
});
