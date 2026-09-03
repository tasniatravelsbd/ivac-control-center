# IVAC Android SMS Collector

This app receives incoming SMS messages only after the operator grants Android's SMS permission. It does not request contacts, call logs, location, files, or media permissions.

## Backend contract

An authenticated operator provisions a collector through the existing backend `POST /api/collectors/register` endpoint. The returned collector key is entered once in the app and stored with Android Keystore-backed encrypted preferences. The app then uses:

- `POST /api/collectors/heartbeat` with `deviceIdentifier` and `X-Collector-Key`.
- `POST /api/sms` with `deviceIdentifier`, `messageUid`, `receiverNumber`, `senderNumber`, `message`, and `receivedAt`.

The server handles sender/receiver normalization, OTP detection/masking, matching, and `messageUid` deduplication. The app never extracts or logs OTP values.

## Build prerequisites

- Android Studio or a compatible Android SDK with platform 35 installed.
- JDK 17.
- A Gradle installation or a generated Gradle wrapper.

Run `gradle :app:assembleDebug` from this directory after installing the prerequisites. Use HTTPS for the backend URL; cleartext traffic is intentionally disabled.

Debug builds alone may use an HTTP loopback/LAN backend for local delivery verification. The debug-only **Queue TEST MESSAGE** control queues the fixed `TEST` / `TEST-SIM` message and requeues the same deterministic UID on a second press, allowing the backend's `409` deduplication acknowledgement to be verified. Release builds require HTTPS and do not show this control.

## Operational notes

Enter the receiving SIM number manually during setup. Android does not reliably expose an MSISDN, so the app records only the optional subscription ID from the inbound broadcast. Multipart SMS PDUs are reconstructed before one deterministic UID is generated. Incoming messages are persisted to Room before upload; WorkManager retries network failures with exponential backoff, retains authentication failures for manual retry, and sends recovery/heartbeat work no more frequently than Android's 15-minute minimum.
