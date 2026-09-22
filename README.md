# Video Drum Board

A 3×4 grid of pads in the browser. Each pad holds a short video clip with its own sound, recorded with the device camera and microphone. Tap a pad and its picture and sound play together, like a drum.

Plain HTML/CSS/JS with no build step and no dependencies. Built for iPad Safari; also fits iPhone screens and runs in desktop Chromium browsers.

The look is bright and cartoon-like for children: a sky-and-hills scene, chunky outlined "toy block" pads in six colours, a little drum mascot, and Apple's rounded system font (other systems fall back to a similar rounded font, so nothing is downloaded).

## Run it

The camera and microphone only work on a secure page: HTTPS, or `localhost` on the same machine.

**On this Mac (quick try),** from this folder:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

**On a phone or iPad on the same Wi-Fi,** from this folder:

```bash
python3 serve.py
```

It prints an address such as `https://192.168.1.20:8443`; open it on the phone. Safari warns that the connection is not private, because `serve.py` makes its own throwaway certificate: tap **Show Details**, then **visit this website**, then **Visit Website**. Only the app's own files are served. Each time `serve.py` restarts it makes a new certificate, so the phone shows the warning once more. Boards are saved per address, so if the Mac's address changes, the phone starts with an empty board (the old one stays stored under the old address).

**For a permanent link** (no warning, any network, and you can Add to Home Screen): upload `index.html`, `style.css` and `js/` to any static HTTPS host (GitHub Pages, Netlify, Cloudflare Pages, …).

When Safari asks for the camera and microphone, allow both. To stop Safari asking again on later visits, set Camera and Microphone to **Allow** for the site in Safari's website settings.

## Use it

- **Record:** tap an empty pad. It shows the live camera and listens. Make a sound (clap, knock, "tss") and the pad records it. Recording keeps a moment from just before the sound, stops when the sound dies away, and never runs past 1 second. To record without waiting for a sound, tap the pad again. ✕ cancels, and ⟲ switches between the front and back cameras.
- **Play:** tap a filled pad. Tapping again restarts it from the top, and several pads can play at once with several fingers.
- **Re-record / clear:** tap **Edit**. Each filled pad shows **Re-record** and **Clear** (tap Clear twice to confirm). The other pads are untouched. Tap **Done** to go back to playing.
- The board is saved in the browser (IndexedDB) after every change, so a reload brings it back.

## How it works

| File | Role |
| --- | --- |
| `index.html`, `style.css` | Page and layout: 3 columns × 4 rows in portrait, 4 × 3 in landscape |
| `js/main.js` | Board UI, edit mode, and the render loop that draws each pad's frames |
| `js/capture.js` | Recording: camera and mic via `getUserMedia`, sound trigger, silence stop |
| `js/capture-worklet.js` | AudioWorklet that streams microphone samples to the page |
| `js/audio.js` | Shared `AudioContext`: low-latency playback and iOS audio unlock |
| `js/clip.js` | Converts a recording into a playable clip and a storable record, and back |
| `js/store.js` | IndexedDB: one record per pad |
| `serve.py` | Optional: serves the app over HTTPS to devices on your Wi-Fi |

Recording does not use `MediaRecorder`; it captures the raw material directly, which the brief allows ("or equivalent"). An MP4 from `MediaRecorder` has to play through a video element, which isn't built for restarting instantly on every tap or for many pads overlapping. So each pad stores:

- **Sound** as raw 16-bit PCM from an AudioWorklet. It plays through Web Audio, so a tap starts it immediately, a repeat tap restarts it, and pads overlap freely. The level is evened out across pads, with a limiter for when many play at once.
- **Picture** as up to 30 frames per second, taken from the live camera and packed into one JPEG image per pad. Each pad's canvas steps through its frames by the audio clock, so picture and sound stay together.

Both are buffered continuously while a pad listens, and share one clock. That allows the clip to start a few milliseconds before the detected sound (so the attack is kept) with frames lined up to the audio. Screen taps are loud to the iPad's microphone, so a tap on the glass is not treated as the recorded sound.

## Worth checking on a real iPad

This was tested in iPad Safari on the iOS simulator and in a desktop Chromium browser, using a synthetic camera and microphone, because the simulator has neither. These parts need a real device:

- **Sync offset:** `VIDEO_LAG` in `js/capture.js` (35 ms) corrects for the camera delivering frames later than the mic delivers sound. Tune it if the picture visibly leads or trails the sound.
- **Trigger sensitivity:** `MIN_TRIGGER` in `js/capture.js`. Raise it if room noise sets off recordings; lower it for quiet sounds. The red mark on the level meter shows the current trigger level.
- **Silent mode:** the app asks Safari (iPadOS 16.4+) to treat its sound as media playback, so pads should still sound when the iPad is set to silent. On older versions, silent mode mutes them.

## Limits

- Safari may delete a site's stored data if the site isn't opened for 7 days. Adding the page to the Home Screen avoids that.
- Everything stays on the device. There is no sharing, export or sync (out of scope for v1).
