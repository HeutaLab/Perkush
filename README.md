# Perkush

A 3×4 grid of drum pads in the browser. Fill each pad with a short video clip and its sound, recorded with the device camera and microphone, or with one of 15 cartoon percussion instruments. Tap a pad and its picture and sound play together, like a drum.

Plain HTML/CSS/JS with no build step and no dependencies. Built for iPad Safari; also fits iPhone screens and runs in desktop Chromium browsers.

The look is bright and cartoon-like for children: a sky-and-hills scene, chunky outlined "toy block" pads in six colours, a little drum mascot, instruments with faces, and Apple's rounded system font (other systems fall back to a similar rounded font, so nothing is downloaded).

The site opens on a front page (`index.html`) that explains what it does and how to play; **Let's play!** goes to the board (`play.html`).

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

**For a permanent link** (no warning, any network, and you can Add to Home Screen): put the folder on any static HTTPS host (GitHub Pages, Netlify, Cloudflare Pages, …). It's published at https://heutalab.github.io/Perkush/.

When Safari asks for the camera and microphone, allow both. To stop Safari asking again on later visits, set Camera and Microphone to **Allow** for the site in Safari's website settings.

## Use it

- **Add a sound:** tap an empty pad. A picker opens with two choices:
  - **Record your own:** the pad shows the live camera and listens. Make a sound (clap, knock, "tss") and the pad records it. Recording keeps a moment from just before the sound, stops when the sound dies away, and never runs past 1 second. To record without waiting for a sound, tap the pad again. ✕ cancels, and ⟲ switches between the front and back cameras.
  - **Pick an instrument:** tap one to hear it, then **Use it** (or tap it again) to put it on the pad.
- **Play:** tap a filled pad. Tapping again restarts it from the top, and several pads can play at once with several fingers. Instruments bounce, ring or shake and pop out a sound word.
- **Change / clear:** tap **Edit**. Each filled pad shows **Change** (opens the picker, so you can re-record or swap instruments) and **Clear** (tap twice to confirm). The other pads are untouched. Tap **Done** to go back to playing.
- The board is saved in the browser (IndexedDB) after every change, so a reload brings it back.

## How it works

| File | Role |
| --- | --- |
| `index.html`, `home.css`, `js/home.js` | Front page: what it is, how to play, tap-to-hear instruments |
| `play.html`, `board.css` | The board: 3 columns × 4 rows in portrait, 4 × 3 in landscape |
| `base.css` | Shared look: colours, scenery, title, buttons, instrument tiles |
| `js/main.js` | Board UI, sound picker, edit mode, and the render loop that draws each pad's frames |
| `js/instruments.js` | The 15 cartoon instruments: drawings, synthesised sounds and animations |
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

The instruments need no sound files: each is synthesised with Web Audio (classic drum-machine recipes: pitch-swept sine for the big drum, filtered noise for snare and shakers, detuned square waves for cymbals and cowbell) in one offline render when the app starts, then played exactly like a recorded pad. A pad with an instrument is saved as just its name.

## Worth checking on a real iPad

This was tested in iPad Safari on the iOS simulator and in a desktop Chromium browser, using a synthetic camera and microphone, because the simulator has neither. These parts need a real device:

- **Sync offset:** `VIDEO_LAG` in `js/capture.js` (35 ms) corrects for the camera delivering frames later than the mic delivers sound. Tune it if the picture visibly leads or trails the sound.
- **Trigger sensitivity:** `MIN_TRIGGER` in `js/capture.js`. Raise it if room noise sets off recordings; lower it for quiet sounds. The red mark on the level meter shows the current trigger level.
- **Silent mode:** the app asks Safari (iPadOS 16.4+) to treat its sound as media playback, so pads should still sound when the iPad is set to silent. On older versions, silent mode mutes them.

## Limits

- Safari may delete a site's stored data if the site isn't opened for 7 days. Adding the page to the Home Screen avoids that.
- Everything stays on the device. There is no sharing, export or sync (out of scope for v1).
