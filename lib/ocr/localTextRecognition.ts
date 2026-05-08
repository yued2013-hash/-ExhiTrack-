import { Platform } from 'react-native';
import TextRecognition, {
  TextRecognitionScript,
} from '@react-native-ml-kit/text-recognition';

export type LocalOcrResult = {
  text: string;
  engine: 'mlkit';
};

export async function recognizeTextFromImageUri(uri: string): Promise<LocalOcrResult> {
  if (Platform.OS !== 'android') {
    throw new Error('Local ML Kit OCR is only enabled on Android.');
  }

  const result = await TextRecognition.recognize(
    uri,
    TextRecognitionScript.CHINESE,
  );
  const text = normalizeRecognizedText(result.text);
  if (!text) throw new Error('Local ML Kit OCR returned empty text.');

  return { text, engine: 'mlkit' };
}

export function isNativeOcrUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("doesn't seem to be linked") ||
    message.includes('Native module') ||
    message.includes('TextRecognition')
  );
}

function normalizeRecognizedText(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}
