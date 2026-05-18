# ExhiTrack

ExhiTrack is an Expo React Native app for documenting museum visits. It captures exhibit photos, reads exhibit-label text, lets the user structure artifact metadata manually or with AI assistance, and syncs local records to Supabase.

## Current Status

- Expo development build for Android is required because native ML Kit text recognition is used.
- Local OCR is available through `@react-native-ml-kit/text-recognition`; this does not require paid cloud OCR.
- Supabase stores exhibitions, artifacts, impressions, artifact photos, and artifact-photo links.
- Zhipu AI GLM-4-Flash is the default cloud model for structuring OCR text in the Supabase Edge Function.

## Recent Updates

- Added local OCR entry flow with a `读字` action on exhibit photos.
- Added an OCR text editor where selected source text is copied into structured fields in order: artifact name, dynasty, category, origin, era, and label description.
- Increased the manual selection debounce to 4 seconds so field filling is less sensitive to accidental selection changes.
- Added `新建条目` for cases where one photo contains multiple artifacts or one label describes multiple items.
- Added the formal photo model:
  - `artifact_photos` stores the actual photo/material record.
  - `artifact_photo_links` maps artifacts to one or more photos.
  - One artifact can link to 1..N photos.
  - One photo can be shared by multiple artifacts.
- Added editor UI for adding linked photos with roles: primary, label, detail, scene, and other.
- Added local SQLite migration v9 and Supabase migrations `0006`, `0007`, and `0008` for the formal photo/link model.
- Added sync support for `artifact_photos` and `artifact_photo_links`.
- Updated new capture/import paths so every new artifact also creates its primary formal photo link.
- Updated derived entries so they link to the source photo instead of duplicating the same photo as a separate photo record.
- Added a patch for `@react-native-ml-kit/text-recognition@2.0.0` Android namespace compatibility.

## Verification

Run local checks:

```powershell
pnpm.cmd exec tsc --noEmit
pnpm.cmd lint
git diff --check
```

Manual Android verification:

1. Start the Expo dev-client server.
2. Open the development build on a USB-connected Android device.
3. Capture or import a photo.
4. Confirm the editor shows one linked photo.
5. Tap `读字`, select text in `OCR 原文`, wait 4 seconds, and confirm structured fields are filled in order.
6. Tap `新建条目` and confirm the new artifact shares the source photo.
7. Add another linked photo and confirm the linked-photo count updates.
8. Trigger manual sync and reopen the exhibition to confirm relationships persist.

## Development

Install dependencies:

```powershell
pnpm.cmd install
```

Start the Android dev-client server:

```powershell
pnpm.cmd exec expo start --dev-client --port 8083
```

Build or install a development APK when native dependencies change. Expo Go is not sufficient for this app because ML Kit is a native module.

## Environment

Create `.env.local` from `.env.example` and configure:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`

For cloud AI extraction, configure Supabase Edge Function secrets:

- `AI_PROVIDER=zhipu`
- `ZHIPU_API_KEY`
- `ZHIPU_TEXT_MODEL=glm-4-flash`
- optional Aliyun OCR credentials if using Aliyun OCR separately

DashScope/Bailian is still available as a fallback by setting `AI_PROVIDER=dashscope` and `DASHSCOPE_API_KEY`.

Do not commit real API keys. Rotate any key that has been pasted into chat or logs.

## Next Plan

1. Add a photo-management screen for changing roles, ordering linked photos, and removing incorrect links.
2. Add a clearer artifact/photo grouping workflow for cases where a label photo and several artifact photos need to be associated after capture.
3. Add cloud pull verification on a second device or fresh install to confirm formal photo links restore correctly.
4. Add migration/backfill diagnostics in-app so old local databases can report whether v9 has run successfully.
5. Improve AI extraction fallback: local OCR first, then optional Zhipu GLM structuring when the user enables a cloud API key.
6. Add focused tests around artifact-photo link creation, derived-entry creation, and sync payload generation.
